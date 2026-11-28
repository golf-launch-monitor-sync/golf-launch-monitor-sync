// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The app's frame: loads what the phone keeps, takes the links that open it, syncs when it comes to
 * the front (the plans decide whether anything is fetched), renews an expired Trackman sign-in quietly
 * where it may, sends what the golf.de window saw when the app goes to the back, and shows one view at a time.
 * While it is open it may fetch the handicap record by itself when it is due (spec 1.17.0, lib/autoFetch.ts): in a
 * golf.de window kept behind the screen, gone again when the run ends, the app goes to the back or golf.de is opened.
 * A pro's world ranking and tour pages (spec 1.15.0) have their pair link and their windows too.
 *
 * A link keeps its focus (spec 1.18.0, lib/done.ts): from its first step to *Done* only the kind it came for, and after
 * *Done* back to the app - or, where there is no way back, this one connection's card (`linked`), not the list.
 */

import * as Linking from 'expo-linking';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { AppState, Text, View } from 'react-native';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { targetOf } from '@glmsync/browser/wizard';
import { keepScheduled } from '../background';
import { keepWake } from '../wake';
import { t } from '../i18n';
import { LOOK_AFTER_MS } from '../lib/autoFetch';
import { afterDone, afterLeaving, type DoneHow } from '../lib/done';
import { goBack } from '../lib/firstSync';
import { Once, readIncoming, type Incoming } from '../lib/links';
import { PROVIDERS, type ProviderId, type Services } from '../lib/services';
import { testKeys } from '../lib/wizard';
import type { RankingSite } from '../lib/rankingsPage';
import { tourSiteOf } from '../lib/toursPage';
import type { TourSite } from '@glmsync/provider-tours';
import { services } from '../platform';
import { Home } from './Home';
import { Licenses } from './Licenses';
import { NewView } from './NewView';
import { PairView } from './PairView';
import { FirstSyncView } from './FirstSyncView';
import { GolfdeView } from './GolfdeView';
import { PairHcpView } from './PairHcpView';
import { PairProView } from './PairProView';
import { RankingsView } from './RankingsView';
import { ToursView } from './ToursView';
import { Body, Button, colors, s } from './parts';
import { SignInView } from './SignInView';
import { SyncView } from './SyncView';
import { TestView } from './TestView';
import { TrackmanLoginView } from './TrackmanLoginView';
import { UnseenGolfde } from './UnseenGolfde';

/** Where *Back to …* jumps (a link's `return`, once its target named it as its own) and the app's name. */
export type Back = { url: string; name: string };

export type Screen =
  /**
   * The main view: *Connect new* and the list of connections; with `focus`, one connection's details - `linked`: a
   * link's focus (spec 1.18.0), that card alone, *Done* instead of the way to the list.
   */
  | { name: 'home'; focus?: string; linked?: true }
  /** *Connect new* before any app asked: where to start (or the demo). */
  | { name: 'new' }
  | { name: 'pair'; link: Extract<Incoming, { kind: 'pair' }> }
  /** A pair link for the handicap record (kind=hcp). */
  | { name: 'pairHcp'; link: Extract<Incoming, { kind: 'pair-hcp' }> }
  /** golf.de in the app's window, read along for the handicap record; `linked`/`back`: opened by a link (1.18.0). */
  | { name: 'golfde'; linked?: true; back?: Back }
  /** A pair link for a pro's world ranking pages (kind=pro). */
  | { name: 'pairPro'; link: Extract<Incoming, { kind: 'pair-pro' }> }
  /** The world ranking window: on `site`'s ranking, else the page last sent, else asking which. */
  | { name: 'rankings'; site?: RankingSite; linked?: true; back?: Back }
  /** His tour's pages (a pro's pages too): the window on the tour's site. */
  | { name: 'tours'; site: TourSite; linked?: true; back?: Back }
  /** `focus`: the connection a link was for (`lm:<provider>`), kept to *Done* (1.18.0). */
  | { name: 'signin'; provider: ProviderId; back?: Back; focus?: string }
  | { name: 'sync'; link: { target?: string; return?: string } }
  /** Just signed in: the first sync shown as the wizard's steps 4 and 5, then (with `back`) *Back to …*. */
  | { name: 'first'; target?: string; back?: Back; focus?: string }
  /**
   * Test mode (spec 1.8.0): a test code for one of `keys`' pairings instead of the sign-in, typed (step 2) or from a
   * link; `back` as after a sign-in.
   */
  | { name: 'test'; keys: string[]; code?: string; back?: { url: string; name: string } }
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
    async (token: string, userAgent: string | null) => {
      // Only a key of the account this phone held: on a shared phone the page may bring someone else's.
      if (svc?.signIns.renewalFits('trackman', token)) {
        try {
          // The window's User-Agent read anew with the renewed key (kept beside it, for every call to Trackman).
          await svc.signIns.set('trackman', token, null, userAgent);
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
  /** The screen as the look for a run by itself sees it (it runs later than the render). */
  const screenNow = useRef<Screen['name']>('home');
  screenNow.current = screen.name;
  /** Whether the unseen golf.de window shows (a run by itself, `svc.auto`). */
  const [unseen, setUnseen] = useState(false);

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

  useEffect(() => {
    if (!svc) return;
    return svc.auto.subscribe((st) => setUnseen(st === 'opening' || st === 'running'));
  }, [svc]);
  // The player opens golf.de themselves: a run by itself gives way (interrupted, no hold - they're on golf.de now).
  useEffect(() => {
    if (svc && screen.name === 'golfde') void svc.auto.interrupt();
  }, [svc, screen.name]);

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
      } else if (incoming.kind === 'pair-hcp') {
        setMessage(null);
        setScreen({ name: 'pairHcp', link: incoming });
      } else if (incoming.kind === 'pair-pro') {
        setMessage(null);
        setScreen({ name: 'pairPro', link: incoming });
      } else if (incoming.kind === 'read') {
        // Only with a connection of that kind: without one there is nobody to send what was read to. A read link keeps
        // its focus too (spec 1.18.0): its window, then its card.
        const pro = incoming.what === 'pro';
        void (pro ? svc.pro.view() : svc.hcp.view()).then(
          async (v) => {
            if (v.pairings.length) {
              setMessage(null);
              // A pro's pages: the window of the page last sent from here (his tour profile or page, or a world ranking's).
              const last = pro ? await svc.lastPage.get().catch(() => null) : null;
              const tour = tourSiteOf(last);
              setScreen(!pro ? { name: 'golfde', linked: true } : tour ? { name: 'tours', site: tour, linked: true } : { name: 'rankings', linked: true });
            } else {
              setMessage(t(pro ? 'pro.pairFirst' : 'hcp.pairFirst'));
              setScreen({ name: 'home' });
            }
          },
          () => {
            setMessage(t('start.failed'));
            setScreen({ name: 'home' });
          },
        );
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
    let looking: ReturnType<typeof setTimeout> | null = null;
    // A run of Fetch all by itself, a moment after coming to the front (a link picks its screen first); only in front.
    const lookSoon = () => {
      if (looking) clearTimeout(looking);
      looking = setTimeout(() => {
        looking = null;
        if (stopped || AppState.currentState !== 'active') return;
        void svc.auto.look(screenNow.current === 'golfde').catch(() => false);
      }, LOOK_AFTER_MS);
    };
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
        lookSoon();
      });
    const links = Linking.addEventListener('url', (e) => handle(e.url));
    const front = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        void open();
        void keepWake(svc); // a week on, or a new address: the targets hear it (src/lib/wake.ts decides)
        lookSoon();
      }
      else {
        if (next) clearTimeout(next);
        // What the golf.de window saw goes before iOS stops the app (a timer may never fire behind it).
        if (state === 'background') {
          // A link's focus ends here: whoever opens the app next opens it themselves (spec 1.18.0).
          setScreen((now) => afterLeaving(now));
          if (looking) clearTimeout(looking);
          looking = null;
          // A run of Fetch all doesn't go on in the back (the phone stops the app): it ends and sends what it read -
          // interrupted, not held: nothing went wrong (spec 1.17.0). The unseen window goes with its run.
          void svc.auto
            .interrupt()
            .catch(() => null)
            .then(() => svc.hcp.interruptFetchAll())
            .catch(() => undefined);
          void svc.hcpSender.flush();
        }
      }
    });
    return () => {
      stopped = true;
      if (next) clearTimeout(next);
      if (looking) clearTimeout(looking);
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
  const firstSync = useCallback(() => connectSync(firstTarget), [connectSync, firstTarget]);
  // The first sync is through: the older history follows a chunk at a time while the app is in front.
  const firstThrough = useCallback(() => historyNow.current(), []);
  const firstFocus = screen.name === 'first' ? screen.focus : undefined;
  const firstDone = useCallback(
    (how: DoneHow) => {
      setScreen(afterDone(firstFocus, how));
      if (how === 'stayed') setMessage(t('sync.stayed'));
    },
    [firstFocus],
  );
  /**
   * *Done* in a window a link opened (golf.de's, a pro's pages): back to the app where it may, else this connection's
   * card; opened by the player from its card or the list, the window goes back where it came from.
   */
  const windowDone = useCallback(
    (focus: 'hcp' | 'pro', from: { linked?: true; back?: Back }) => {
      if (!from.linked) return setScreen(focus === 'pro' ? { name: 'home', focus: 'pro' } : { name: 'home' });
      if (!from.back) return setScreen(afterDone(focus, 'here'));
      void goBack(from.back.url, (url) => Linking.openURL(url)).then((how) => {
        setScreen(afterDone(focus, how));
        if (how === 'stayed') setMessage(t('sync.stayed'));
      });
    },
    [],
  );
  /** The app the data of a provider goes to, for the wizard's words (null: several, or none). */
  const targetFor = (provider: string) => (svc ? targetOf(svc.pairings.list().filter((p) => p.provider === provider).map((p) => p.target.name)) : null);

  // Where Trackman's sign-in is asked for, small, a test code instead: for its pairings not in test mode.
  const testable = svc ? testKeys(svc.pairings.list(), 'trackman', (k) => !!svc.tests.of(k)) : [];

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
  } else if (screen.name === 'pairHcp') {
    body = <PairHcpView svc={svc} link={screen.link} go={setScreen} />;
  } else if (screen.name === 'golfde') {
    const from = screen;
    body = <GolfdeView svc={svc} {...(from.back ? { backTo: from.back.name } : {})} done={() => windowDone('hcp', from)} />;
  } else if (screen.name === 'pairPro') {
    body = <PairProView svc={svc} link={screen.link} go={setScreen} />;
  } else if (screen.name === 'rankings') {
    const from = screen;
    const keep = { ...(from.linked ? { linked: true as const } : {}), ...(from.back ? { back: from.back } : {}) };
    body = (
      <RankingsView
        svc={svc}
        {...(from.site ? { site: from.site } : {})}
        {...(from.back ? { backTo: from.back.name } : {})}
        tour={(site) => setScreen({ name: 'tours', site, ...keep })}
        done={() => windowDone('pro', from)}
      />
    );
  } else if (screen.name === 'tours') {
    const from = screen;
    body = <ToursView svc={svc} site={from.site} {...(from.back ? { backTo: from.back.name } : {})} done={() => windowDone('pro', from)} />;
  } else if (screen.name === 'signin') {
    body = (
      <SignInView
        svc={svc}
        provider={screen.provider}
        target={targetFor(screen.provider)}
        {...(screen.back ? { backTo: screen.back.name } : {})}
        {...(screen.provider === 'trackman' && testable.length ? { test: () => setScreen({ name: 'test', keys: testable, ...(screen.back ? { back: screen.back } : {}) }) } : {})}
        done={(signedIn) => {
          renewal.allowAgain();
          // Signed in: the first sync, and when paired from a link with a return, back to the target app once it is
          // through (spec 1.2.0; FirstSyncView).
          if (signedIn) setScreen({ name: 'first', ...(screen.back ? { back: screen.back } : {}), ...(screen.focus ? { focus: screen.focus } : {}) });
          else setScreen(screen.focus ? afterDone(screen.focus, 'here') : { name: 'home' });
        }}
      />
    );
  } else if (screen.name === 'sync') {
    body = <SyncView svc={svc} link={screen.link} renew={renewal.renew} go={setScreen} />;
  } else if (screen.name === 'first') {
    body = <FirstSyncView svc={svc} {...(screen.back ? { back: screen.back } : {})} target={targetFor('trackman')} sync={firstSync} through={firstThrough} done={firstDone} />;
  } else if (screen.name === 'test') {
    body = <TestView svc={svc} keys={screen.keys} {...(screen.code ? { code: screen.code } : {})} {...(screen.back ? { back: screen.back } : {})} go={setScreen} />;
  } else if (screen.name === 'licenses') {
    body = <Licenses back={home} />;
  } else if (screen.name === 'new') {
    body = <NewView go={setScreen} />;
  } else {
    body = <Home svc={svc} {...(screen.focus ? { focus: screen.focus } : {})} {...(screen.linked ? { linked: true } : {})} message={message} dismiss={() => setMessage(null)} go={setScreen} renewing={renewal.on} />;
  }

  return (
    <SafeAreaView style={s.screen} edges={['top', 'bottom']}>
      {/* Behind the screen, full size (iOS suspends a web view that isn't on screen); the screen covers it. */}
      {svc && unseen && <UnseenGolfde svc={svc} />}
      <View style={s.screen}>{body}</View>
      {renewal.on && <TrackmanLoginView hidden onToken={(token, userAgent) => void renewal.onToken(token, userAgent)} />}
    </SafeAreaView>
  );
}
