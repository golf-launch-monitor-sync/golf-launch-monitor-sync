// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The app's frame: loads what the phone keeps, takes the links that open it, syncs when it comes to
 * the front (the plans decide whether anything is fetched), renews an expired Trackman sign-in quietly
 * where it may, and shows one view at a time.
 */

import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { keepScheduled } from '../background';
import { keepWake } from '../wake';
import { t } from '../i18n';
import { Once, readIncoming, type Incoming } from '../lib/links';
import { PROVIDERS, type ProviderId, type Services } from '../lib/services';
import { services } from '../platform';
import { Home } from './Home';
import { Licenses } from './Licenses';
import { PairView } from './PairView';
import { FirstSyncView } from './FirstSyncView';
import { Body, Button, colors, s } from './parts';
import { SignInView } from './SignInView';
import { SyncView } from './SyncView';
import { TestView } from './TestView';
import { TrackmanLoginView } from './TrackmanLoginView';

export type Screen =
  | { name: 'home' }
  | { name: 'pair'; link: Extract<Incoming, { kind: 'pair' }> }
  | { name: 'signin'; provider: ProviderId; back?: { url: string; name: string } }
  | { name: 'sync'; link: { target?: string; return?: string } }
  /** Just paired or signed in: the first sync, then (with `back`) back to the target app. */
  | { name: 'first'; target?: string; back?: { url: string; name: string } }
  /** Test mode (spec 1.8.0): a test code for one of `keys`' pairings, typed or from a link. */
  | { name: 'test'; keys: string[]; code?: string }
  | { name: 'licenses' };

/** Coming to the front again within this long asks the plans only once. */
const OPEN_EVERY_MS = 60_000;
/** A quiet renewal gives up after this long (a link that waits to jump back, sooner). */
export const RENEW_MS = 45_000;

export function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Main />
    </SafeAreaProvider>
  );
}

/**
 * The quiet renewal: Trackman's page in a hidden window, once per start of the app, only where this
 * phone held the player's key before. `renew` resolves when a key came or the time is up.
 */
function useRenewal(svc: Services | null) {
  const [on, setOn] = useState(false);
  const tried = useRef(false);
  const active = useRef(false);
  const waiters = useRef<(() => void)[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const finish = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    active.current = false;
    setOn(false);
    const w = waiters.current;
    waiters.current = [];
    for (const done of w) done();
  }, []);

  const renew = useCallback(
    (maxMs: number) =>
      new Promise<void>((done) => {
        if (active.current) {
          waiters.current.push(done); // one already under way: wait for it
          return;
        }
        if (!svc || tried.current || !svc.signIns.canRenew('trackman')) return done();
        tried.current = true;
        active.current = true;
        waiters.current.push(done);
        setOn(true);
        timer.current = setTimeout(finish, maxMs);
      }),
    [svc, finish],
  );

  const onToken = useCallback(
    async (token: string) => {
      // Only a key of the account this phone held: on a shared phone the page may bring someone else's.
      if (svc?.signIns.renewalFits('trackman', token)) {
        try {
          await svc.signIns.set('trackman', token);
        } catch {
          // the secure store refused: the player signs in again by hand
        }
      }
      finish();
    },
    [svc, finish],
  );

  /** After a sign-in by hand the next expiry may be renewed quietly again. */
  const allowAgain = useCallback(() => {
    tried.current = false;
  }, []);

  return { on, renew, onToken, allowAgain };
}

function Main() {
  const [svc, setSvc] = useState<Services | null>(null);
  const [broken, setBroken] = useState(false);
  const [screen, setScreen] = useState<Screen>({ name: 'home' });
  const [message, setMessage] = useState<string | null>(null);
  const [, redraw] = useReducer((x: number) => x + 1, 0);
  const renewal = useRenewal(svc);
  const once = useRef(new Once());
  /** Starts the older history now, while the app is in front (set by the effect below). */
  const historyNow = useRef<() => void>(() => undefined);

  const start = useCallback(() => {
    setBroken(false);
    services().then(setSvc, () => setBroken(true));
  }, []);
  useEffect(start, [start]);

  useEffect(() => {
    if (!svc) return;
    const offs = [svc.signIns.subscribe(redraw), svc.pairings.subscribe(redraw), svc.runner.subscribe(redraw), svc.tests.subscribe(redraw)];
    return () => {
      for (const off of offs) off();
    };
  }, [svc]);

  // The background task runs while there is a target to sync for.
  const paired = svc ? svc.pairings.list().length : 0;
  useEffect(() => {
    if (svc) void keepScheduled(paired > 0);
  }, [svc, paired]);
  // iOS: each paired target hears where it may wake this phone (spec/wake.md), again when the pairings change.
  useEffect(() => {
    if (svc) void keepWake(svc);
  }, [svc, paired]);

  const handle = useCallback(
    (url: string) => {
      if (!svc || !once.current.fresh(url, Date.now())) return;
      const incoming = readIncoming(url, PROVIDERS, svc.pairings.list());
      if (incoming.kind === 'invalid') {
        setMessage(t('link.invalid'));
        setScreen({ name: 'home' });
      } else if (incoming.kind === 'test') {
        // A test link never pairs: without a pairing of its app there is nothing to take the code for.
        if (!incoming.keys.length) {
          setMessage(t('test.pairFirst'));
          setScreen({ name: 'home' });
        } else {
          setMessage(null);
          setScreen({ name: 'test', keys: incoming.keys, code: incoming.code });
        }
      } else if (incoming.kind === 'pair') {
        setMessage(null);
        setScreen({ name: 'pair', link: incoming });
      } else {
        setMessage(null);
        setScreen({ name: 'sync', link: { ...(incoming.target ? { target: incoming.target } : {}), ...(incoming.return ? { return: incoming.return } : {}) } });
      }
    },
    [svc],
  );

  // Links, and coming to the front: the plans of all pairings (reason "open"), then the older history
  // a chunk at a time while the app stays open.
  useEffect(() => {
    if (!svc) return;
    let stopped = false;
    let lastOpen = 0;
    let next: ReturnType<typeof setTimeout> | null = null;
    // One loop at a time: a newer start ends the one before at its next step.
    let gen = 0;
    const history = async (mine = ++gen) => {
      const wait = await svc.runner.backfill().catch(() => null);
      if (stopped || mine !== gen || wait === null || AppState.currentState !== 'active') return;
      next = setTimeout(() => void history(mine), Math.max(5, wait) * 1000);
    };
    // Only in front: a chunk started as the app goes to the back stops there and holds the target's lease.
    historyNow.current = () => {
      if (stopped || AppState.currentState !== 'active') return;
      if (next) clearTimeout(next);
      void history();
    };
    const open = async () => {
      if (Date.now() - lastOpen < OPEN_EVERY_MS || !svc.pairings.list().length) return;
      lastOpen = Date.now();
      await renewal.renew(RENEW_MS);
      await svc.runner.syncAll('open').catch(() => undefined);
      if (next) clearTimeout(next);
      if (!stopped) void history();
    };
    void Linking.getInitialURL()
      .catch(() => null)
      .then((url) => {
        if (stopped) return;
        if (url) {
          lastOpen = Date.now(); // the link's own sync stands for the opening's
          handle(url);
        } else void open();
      });
    const links = Linking.addEventListener('url', (e) => handle(e.url));
    const front = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void open();
        void keepWake(svc); // a week on, or a new address: the targets hear it (src/lib/wake.ts decides)
      }
      else if (next) clearTimeout(next);
    });
    return () => {
      stopped = true;
      if (next) clearTimeout(next);
      links.remove();
      front.remove();
    };
  }, [svc, handle, renewal.renew]);

  const home = useCallback(() => setScreen({ name: 'home' }), []);

  /** The first sync after pairing or signing in (the plans decide what it brings); then the older history. */
  const connectSync = useCallback(
    async (target?: string) => {
      if (!svc) return;
      await svc.runner.syncAll('connect', target ? { target } : {}).catch(() => undefined);
    },
    [svc],
  );
  const firstTarget = screen.name === 'first' ? screen.target : undefined;
  const firstBack = screen.name === 'first' ? screen.back : undefined;
  const firstSync = useCallback(() => connectSync(firstTarget), [connectSync, firstTarget]);
  const firstDone = useCallback(
    (how: 'back' | 'stayed' | 'here') => {
      home();
      if (how === 'stayed') setMessage(t('sync.stayed'));
      historyNow.current();
    },
    [home],
  );
  // Without a way back the app stays: home at once, the first sync and the history while it is in front.
  useEffect(() => {
    if (screen.name !== 'first' || screen.back) return;
    home();
    void connectSync(screen.target).then(() => historyNow.current());
  }, [screen, home, connectSync]);

  let body;
  if (broken) {
    body = (
      <View style={[s.scroll, { flex: 1, justifyContent: 'center' }]}>
        <Body>{t('start.failed')}</Body>
        <Button label={t('action.retry')} onPress={start} />
      </View>
    );
  } else if (!svc) {
    body = (
      <View style={[s.scroll, { flex: 1, justifyContent: 'center' }]}>
        <Text style={{ color: colors.muted, textAlign: 'center' }}>{t('start.loading')}</Text>
      </View>
    );
  } else if (screen.name === 'pair') {
    body = <PairView svc={svc} link={screen.link} go={setScreen} />;
  } else if (screen.name === 'signin') {
    body = (
      <SignInView
        svc={svc}
        provider={screen.provider}
        {...(screen.back ? { backTo: screen.back.name } : {})}
        done={(signedIn) => {
          renewal.allowAgain();
          // Signed in: the first sync, and when paired from a link with a return, back to the target app once it is
          // through (spec 1.2.0; FirstSyncView).
          if (signedIn) setScreen({ name: 'first', ...(screen.back ? { back: screen.back } : {}) });
          else home();
        }}
      />
    );
  } else if (screen.name === 'sync') {
    body = <SyncView svc={svc} link={screen.link} renew={renewal.renew} go={setScreen} />;
  } else if (screen.name === 'first' && firstBack) {
    body = <FirstSyncView back={firstBack} sync={firstSync} done={firstDone} />;
  } else if (screen.name === 'test') {
    body = <TestView svc={svc} keys={screen.keys} {...(screen.code ? { code: screen.code } : {})} go={setScreen} />;
  } else if (screen.name === 'licenses') {
    body = <Licenses back={home} />;
  } else {
    body = <Home svc={svc} message={message} dismiss={() => setMessage(null)} go={setScreen} renewing={renewal.on} />;
  }

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      {body}
      {renewal.on && <TrackmanLoginView hidden onToken={(token) => void renewal.onToken(token)} />}
    </SafeAreaView>
  );
}
