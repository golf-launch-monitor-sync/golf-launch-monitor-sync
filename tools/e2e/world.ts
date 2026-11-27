// SPDX-License-Identifier: MIT
// Copyright (c) 2026 Reginald Stadlbauer
/**
 * The click checks' world: everything the browser would reach on the network, answered in the test
 * instead - the web app from its build, a made-up Trackman portal and API, a made-up golf.de (its pages make their
 * own requests, as golf.de's do), a made-up OWGR player page, and a made-up target app. Nothing leaves the machine; all data is synthetic.
 */

import type { BrowserContext, Route } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FetchLike } from '../../packages/core/src/http.ts';
import { FakeHcpTarget, FakeProTarget, FakeTarget, type PlanAsked } from '../../packages/core/src/testing/index.ts';
import { entry, historyAnswer, memberAnswer, resultsAnswer, scoringAnswer, tournamentHtml } from '../../packages/provider-golfde/src/testing.ts';
import { GRAPHQL_URL } from '../../packages/provider-trackman/src/client.ts';
import { FakeTrackman, fakeToken } from '../../packages/provider-trackman/src/testing.ts';
import { ACCESS as SHAPE_ACCESS, PERSON as SHAPE_PERSON, PROFILE_ANSWER, SESSIONS_ANSWER } from '../../packages/shape/src/testing.ts';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const WEB_DIST = join(ROOT, 'apps', 'web', 'dist');
export const WEB = 'https://golf-launch-monitor-sync.github.io/golf-launch-monitor-sync';
export const PORTAL = 'https://portal.trackmangolf.com/';
/** The made-up target app's own page (its web app), on the target's origin. */
export const APP_PAGE = 'https://app.example.org/profile';
export const TARGET = 'https://app.example.org/lm/v1';
export const CODE = 'K7M2PQ9X';
/** A test code of the made-up target's test account (test mode, spec/test-mode.md). */
export const TEST_CODE = 'T17K2M9Q';
export const TEST_SUBJECT = 'example-test-T17-neu-leon';
const DAY = 86_400_000;
/** The made-up target app's handicap API (spec/hcp.md) and its pairing code. */
export const HCP_TARGET = 'https://app.example.org/hcp/v1';
export const HCP_CODE = 'H7M2PQ9X';
export const GOLFDE_HISTORY = 'https://www.golf.de/mein-bereich/handicap-history-sheet.html';
export const GOLFDE_RESULTS = 'https://www.golf.de/sport/turnierkalender/clubturniere.html#/5001/ergebnisse';
/** A header the made-up golf.de page puts on its own requests: one without it would not be golf.de's page's. */
export const GOLFDE_PAGE_HEADER = 'x-made-up-golfde-page';

/** The made-up target app's API for a pro's pages (spec/prores.md; a real target may use its handicap API) and its code. */
export const PRO_TARGET = 'https://app.example.org/pro/v1';
export const PRO_CODE = 'P7M2PQ9X';
/** A made-up player's page on OWGR (made-up name, made-up tournaments). */
export const OWGR_PAGE = 'https://www.owgr.com/playerprofile/max-mustermann-90001';

/**
 * The made-up OWGR player page: the head with its figures at once, the table of events a moment later, put in by the
 * page's own script as owgr.com's is. It asks nothing of anyone.
 */
function owgrPage(): string {
  const fig = (v: string, label: string) => `<div><div>${v}</div><div>${label}</div></div>`;
  const row = (name: string, href: string | null, tour: string, week: number, finish: string, points: string) =>
    `<tr><td>${href ? `<a href="${href}"><span>${name}</span></a>` : name}</td><td><button><span>${tour}</span></button></td><td>${week}</td><td>2026</td><td>${finish}</td><td>${points}</td><td>1.0000</td><td>${points}</td><td>4</td><td>3</td></tr>`;
  const table = `<table><thead><tr>${['EVENT', 'TOUR', 'WEEK', 'YEAR', 'FINISH POS.', 'POINTS WON', 'WEIGHT', 'ADJ. POINTS', 'RANK FROM', 'RANK TO'].map((x) => `<th><button>${x}</button></th>`).join('')}</tr></thead><tbody>${[
    row('Musterstadt Open', '/events/musterstadt-open-90012', 'DPWT', 40, 'T17', '2.16597'),
    row('Multi Win Bonus 70% - Musterstadt Open', null, 'DPWT', 40, 'BP', '4.00000'),
    row('A Major Somewhere', '/events/a-major-somewhere-89950', 'Maj', 29, 'MC', '-'),
  ].join('')}</tbody></table>`;
  return `<!doctype html><html><head><title>Official World Golf Ranking - Player Profile</title></head><body>
<main><div><div>Max Mustermann</div><div><div>World number</div><div>412</div></div></div>
<div><div>Statistics</div>${fig('412th', 'Current OWGR Rank')}${fig('390th', 'Best OWGR Rank')}${fig('0.9871', 'Average Points')}${fig('39.48', 'Total Points')}${fig('40', 'Divisor')}${fig('38', 'Actual Events Played')}</div>
<div id="events"><div class="spinner">…</div></div></main>
<script>setTimeout(() => { document.getElementById('events').innerHTML = ${JSON.stringify(table)}; }, 800);</script></body></html>`;
}

/** A made-up player's profile on the Pro Golf Tour (made-up name, made-up tournaments). */
export const PGT_PROFILE = 'https://www.progolftour.de/player-profile/99001?year=2026';

/** The made-up Pro Golf Tour profile: the head with the Order of Merit, the season's tournaments (no rounds). */
function pgtProfilePage(): string {
  const row = (start: string, end: string, slug: string, name: string, pos: string, points: string) =>
    `<tr><td></td><td>${start}</td><td>—</td><td>${end}</td><td><a href="/tournament-details/${slug}">${name} <i>&#xE001;</i></a></td><td>${pos}</td><td>€ 1.00</td><td>${points}</td></tr>`;
  return `<!doctype html><html><head><title>Players detail page - PGT (EN)</title></head><body>
<h2>Beispiel</h2><h3>Lena</h3><h1>Lena Beispiel <button>Year 2026</button></h1>
<div><div>Order of Merit</div><div><i>&#xE002;</i> 7th</div></div><div><div>Season points</div><div>17,290.60</div></div>
<table><thead><tr><th></th><th>Start</th><th></th><th>End</th><th>Tournament</th><th>Position</th><th>Prize money</th><th>Score</th></tr></thead><tbody>
${row('02.03.2026', '04.03.2026', 'sample-desert-open-2026', 'Sample Desert Open 2026', 'T6', '1,027.50')}
${row('16.06.2026', '18.06.2026', 'beispiel-k%C3%B6ln-classic-2026', 'Beispiel Köln Classic 2026', 'MC', '—')}
</tbody></table></body></html>`;
}

/** A made-up tournament's page: its facts at once, the final result a moment later (put in by the page's script). */
function pgtResultPage(slug: string): string {
  const desert = slug === 'sample-desert-open-2026';
  const line = (pos: string, name: string, r: number[]) => `<tr><td></td><td>${pos}</td><td></td><td>${name}</td><td>-1</td><td>-2</td><td>F</td>${[0, 1, 2].map((i) => `<td>${r[i] ?? ''}</td>`).join('')}<td>${r.reduce((a, b) => a + b, 0)}</td><td>—</td><td>1.00</td></tr>`;
  const rows = desert
    ? [line('1', 'Otto Erfunden', [66, 67, 68]), line('T6', 'Lena Beispiel', [69, 70, 70]), line('T6', 'Max Ausgedacht', [70, 70, 69])]
    : [line('1', 'Otto Erfunden', [66, 67, 68]), line('MC', 'Lena Beispiel', [74, 76])];
  const table = `<table><thead><tr>${['', '#', '', 'Player', 'Today', 'To Par', 'Hole', 'R1', 'R2', 'R3', 'Total', 'Prize money', 'Score'].map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  const id = desert ? 5101 : 5102;
  return `<!doctype html><html><head><title>Tournament - PGT (EN)</title></head><body>
<h3>${desert ? 'Sample Desert Open 2026' : 'Beispiel Köln Classic 2026'}</h3>
<dl><dt>Golfclub:</dt><dd><i>&#xE003;</i>Sample Golf Club<i>&#xE004;</i>Road 1, 12345 Sampletown, ${desert ? 'Egypt' : 'Germany'}</dd><dt>Date:</dt><dd>${desert ? '02.03.2026 - 04.03.2026' : '16.06.2026 - 18.06.2026'}</dd></dl>
<ul><li><a href="/tournament-details/${slug}?tab=livescoring&tournament=${id}#livescoring-${id}">Final result</a></li></ul>
<h3>Final result ${desert ? 'Sample Desert Open 2026' : 'Beispiel Köln Classic 2026'}</h3><ul><li><i>&#xE005;</i>Sample Golf Club PAR 71</li></ul>
<div id="result">…</div>
<script>setTimeout(() => { document.getElementById('result').innerHTML = ${JSON.stringify(table)}; }, 600);</script></body></html>`;
}

/** A made-up player's results on europeantour.com (made-up name, made-up tournaments). */
export const ET_RESULTS = 'https://www.europeantour.com/players/jonas-beispiel-99002/results?tour=hotelplanner-tour';

/**
 * The made-up results page: the head with his rank above its label, the season's select, and the table the page's
 * script puts in a moment later (another season's when he picks it; a made-up other player in the wins' table).
 */
function etResultsPage(): string {
  const head = ['', 'End Date', 'Tournament', 'Pos.', 'R2DR Points', 'R2MR Points', 'Prize Money', 'R1', 'R2', 'R3', 'R4', 'Total', 'To Par', 'History'];
  const row = (end: string, path: string, name: string, pos: string, dp: string, hp: string, r: (number | '-')[], total: string, toPar: string) =>
    `<tr><td></td><td><span>${end}</span></td><td><a href="/${path}/"><span>${name}</span></a></td><td>${pos}</td><td>${dp}</td><td>${hp}</td><td>€1,000.00</td>${r.map((x) => `<td><span>${x}</span></td>`).join('')}<td>${total}</td><td>${toPar}</td><td></td></tr>`;
  const table = (rows: string[]) => `<table><thead><tr>${head.map((h) => `<th><span>${h}</span></th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table>`;
  const seasons = {
    2026: table([
      row('01/11/2026', 'hotelplanner-tour/made-up-grand-final-2026', 'Made-up Grand Final', '9T', '', '63.25', [70, 69, 68, 71], '278', '-10'),
      row('11/10/2026', 'hotelplanner-tour/sample-open-2026', 'Sample Open', '80T', '', '', [72, 75, '-', '-'], '-', '-'),
      row('05/07/2026', 'dpworld-tour/beispiel-international-2026', 'Beispiel International', '43T', '12.5', '', [70, 71, 72, 73], '286', '-2'),
    ]),
    2025: table([row('14/09/2025', 'hotelplanner-tour/old-sample-challenge-2025', 'Old Sample Challenge', '2', '', '120.0', [66, 67, 68, 69], '270', '-18')]),
  };
  const wins = `<table><thead><tr><th>End Date</th><th>Tournament</th><th>R1</th></tr></thead><tbody><tr><td>01/01/2026</td><td>Otto ERFUNDEN</td><td>60</td></tr></tbody></table>`;
  return `<!doctype html><html><head><title>Wins &amp; Results - Jonas BEISPIEL - Players - European Tour</title></head><body>
<div><p>Player profile</p><h2>Jonas BEISPIEL</h2>
<div><div><p>2</p><p>HPT WINS</p></div><div><p>12th</p><p>R2M</p></div><div><p>401st</p><p>OWGR</p></div></div></div>
<h3>Wins and Results</h3>${wins}
<h4>Tournament Results</h4><select id="season"><option>2026</option><option>2025</option></select>
<div id="results">…</div>
<script>
const seasons = ${JSON.stringify(seasons)};
const show = () => { document.getElementById('results').innerHTML = '…'; setTimeout(() => { document.getElementById('results').innerHTML = seasons[document.getElementById('season').value]; }, 600); };
document.getElementById('season').addEventListener('change', show);
show();
</script></body></html>`;
}

/** A made-up player's pages on pgatour.com (made-up name, made-up tournaments). */
export const PGA_OVERVIEW = 'https://www.pgatour.com/player/99002/max-erfunden/overview';
export const LPGA_RESULTS = 'https://www.lpga.com/athletes/lena-ausgedacht/99003/results';
export const LPGA_STATS = 'https://www.lpga.com/athletes/lena-ausgedacht/99003/stats';

/**
 * The made-up pgatour.com player page, as the site builds it: a leaderboard strip of other players at the top, the head,
 * the tabs; *Results* is put in by the page's own script without loading a page (the address changes by pushState), its
 * season's table a moment later. It asks nothing of anyone.
 */
function pgaPlayerPage(path: string): string {
  // The pickers are menu buttons, as the site draws them: a press opens a menu of entries, an entry picks.
  const picker = (label: string, value: string) =>
    `<span class="picker"><button aria-haspopup="menu" data-picker="${label}"><div><div><div><p>${label}</p></div></div></div><p class="shows">${value}</p></button></span>`;
  const row = (date: string, name: string, pos: string, r: string[], pts: string, id: string | null) =>
    `<tr><td><span>${date}</span></td><td><span>${name}</span></td><td><span>${pos}</span></td>${r.map((x) => `<td><span>${x}</span></td>`).join('')}<td>${r.filter((x) => x !== '-').reduce((a, b) => a + Number(b), 0)}</td><td>-3</td><td>50</td><td>${pts}</td><td></td><td>-</td><td>-</td><td>$1,000</td><td>${id ? `<a href="https://tourcast.pgatour.com/tourcast.html?id=${id}&webview=true#/hole-view?round=1&hole=1"><img alt="TOURCAST Logo"></a>` : '-'}</td></tr>`;
  const head = ['Date', 'Tournament', 'Pos', 'R1', 'R2', 'R3', 'R4', 'Total', 'To Par', 'Rank', 'Pts', '', 'Rank', 'Pts', 'Winnings', ''];
  const table = `<h2>Results &amp; Scorecards</h2><table><thead><tr><th></th><th>FedExCup</th><th></th><th>FedexCup Fall</th></tr><tr></tr><tr>${head.map((h) => `<th><span>${h}</span></th>`).join('')}</tr></thead><tbody>${[
    row('1.25.2026', 'Sample Desert Classic', 'CUT', ['71', '66', '70', '-'], '-', 'R2026902'),
    row('2.1.2026', 'Made-up Coast Open', 'T5', ['65', '75', '65', '68'], '105.000', 'R2026904'),
    row('4.26.2026', 'Zurich Classic of Sampletown', 'CUT', ['61', '76', '-', '-'], '-', 'R2026918'),
  ].join('')}</tbody></table>`;
  // His 2025 season, picked in the *Season* menu; the Korn Ferry Tour he didn't play (an empty table).
  const table2025 = `<h2>Results &amp; Scorecards</h2><table><thead><tr><th></th><th>FedExCup</th><th></th><th>FedexCup Fall</th></tr><tr></tr><tr>${head.map((h) => `<th><span>${h}</span></th>`).join('')}</tr></thead><tbody>${row('3.9.2025', 'Earlier Sample Classic', 'T9', ['70', '70', '70', '70'], '60.000', 'R2025910')}</tbody></table>`;
  const tableKft = `<h2>Results &amp; Scorecards</h2><table><thead><tr>${head.map((h) => `<th><span>${h}</span></th>`).join('')}</tr></thead><tbody></tbody></table>`;
  const results = `<div><button>Season</button><button>Tournament</button></div><div>${picker('Tour', 'PGA Tour')}${picker('Season', '2026')}</div>
<div id="standing"><div><img alt="FedExCup Standings"><div><div>83</div><div>PTS: 494</div></div></div>
<div><img alt="FedExCup Fall Standings"><div><div>83</div><div>PTS: 663</div></div></div></div><div id="season">…</div>`;
  // *Stats*: the pickers, the strokes gained chart (labels only, never read) and the table, its first cell with the
  // arrow icon's hidden text, as the site writes it.
  const stat = (label: string, value: string, rank: string) =>
    `<tr><td><a href="/stats/detail/1">${label}<span><span>Right Arrow</span><img alt=""><span>Right Arrow</span></span></a></td><td><span>${value}</span></td><td><span>${rank}</span></td><td><div><span>Measured Rounds</span><span>(61)</span></div></td><td></td></tr>`;
  const statsTable = `<h2>Stat Rankings</h2><table><thead><tr></tr><tr>${['STAT', 'VALUE', 'RANK', 'SUPPORTING STAT', 'VALUE'].map((h) => `<th><span>${h}</span></th>`).join('')}</tr></thead><tbody>${[
    stat('SG: Total', '0.912', '21'),
    stat('SG: Off-the-Tee', '-0.104', '110'),
    stat('Driving Distance', '301.4', '60'),
    stat('Greens in Regulation Percentage', '68.40%', '50'),
    stat('Proximity to Hole', "37' 6", '90'),
    stat('Scoring Average (Actual)', '70.31', '40'),
    stat('Official Money', '$1,234,567', '70'),
  ].join('')}</tbody></table>`;
  const statsTable2025 = statsTable.replace('301.4', '299.0').replace('0.912', '0.715');
  const stats = `<div>${picker('Tour', 'PGA Tour')}${picker('Season', '2026')}</div><div><span>SG: Total</span><span>SG: Putting</span></div><div id="season">…</div>`;
  const script = `
    const show = (html, later) => {
      document.getElementById('tab').innerHTML = html;
      setTimeout(() => { document.getElementById('season').innerHTML = later; }, 700);
    };
    const go = (id, part, html, later) => document.getElementById(id).addEventListener('click', (e) => {
      e.preventDefault(); history.pushState({}, '', '/player/99002/max-erfunden/' + part); show(html, later);
    });
    go('results', 'results', ${JSON.stringify(results)}, ${JSON.stringify(table)});
    go('stats', 'stats', ${JSON.stringify(stats)}, ${JSON.stringify(statsTable)});
    if (location.pathname.endsWith('/results')) show(${JSON.stringify(results)}, ${JSON.stringify(table)});
    if (location.pathname.endsWith('/stats')) show(${JSON.stringify(stats)}, ${JSON.stringify(statsTable)});
    // The menus: a press on a picker opens its entries, a press on an entry picks it and the season's table follows.
    const tables = {
      results: { 'PGA Tour': { 2026: ${JSON.stringify(table)}, 2025: ${JSON.stringify(table2025)} }, 'Korn Ferry Tour': { 2026: ${JSON.stringify(tableKft)}, 2025: ${JSON.stringify(tableKft)} } },
      stats: { 'PGA Tour': { 2026: ${JSON.stringify(statsTable)}, 2025: ${JSON.stringify(statsTable2025)} }, 'Korn Ferry Tour': { 2026: '', 2025: '' } },
    };
    const entries = { Tour: ['PGA Tour', 'Korn Ferry Tour', 'PGA Tour Champions'], Season: ['2026', '2025'] };
    const shown = (name) => document.querySelector('[data-picker="' + name + '"] .shows')?.textContent;
    document.addEventListener('click', (e) => {
      const item = e.target.closest('[role="menuitem"]');
      if (item) {
        const name = item.closest('[role="menu"]').dataset.for;
        document.querySelector('[data-picker="' + name + '"] .shows').textContent = item.textContent;
        item.closest('[role="menu"]').remove();
        // A tour he didn't play shows no standing.
        const standing = document.getElementById('standing');
        if (standing) {
          standing.dataset.kept ??= standing.innerHTML;
          standing.innerHTML = shown('Tour') === 'PGA Tour' ? standing.dataset.kept : '';
        }
        const part = location.pathname.endsWith('/stats') ? 'stats' : 'results';
        document.getElementById('season').innerHTML = '…';
        setTimeout(() => { document.getElementById('season').innerHTML = tables[part][shown('Tour')]?.[shown('Season')] ?? ''; }, 700);
        return;
      }
      const b = e.target.closest('button[aria-haspopup]');
      if (!b) return;
      document.querySelectorAll('[role="menu"]').forEach((m) => m.remove());
      const name = b.dataset.picker;
      setTimeout(() => {
        b.parentElement.insertAdjacentHTML('beforeend', '<div role="menu" data-for="' + name + '">' + entries[name].map((x) => '<button role="menuitem">' + x + '</button>').join('') + '</div>');
      }, 200);
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') document.querySelectorAll('[role="menu"]').forEach((m) => m.remove()); });`;
  return `<!doctype html><html><head><title>Max Erfunden PGA Tour Player Profile (made up)</title></head><body>
<div><a href="/leaderboard?player=1">O. Erfunden</a><div>Pos</div><div>1</div></div>
<main><h1><span>Max</span><span>Erfunden</span></h1><div><div><div>World Rank (OWGR)</div></div><div>122</div></div>
<div role="tablist"><a href="${path.replace(/\/[a-z-]+$/, '/overview')}">Overview</a><a id="results" href="/player/99002/max-erfunden/results">Results</a><a id="stats" href="/player/99002/max-erfunden/stats">Stats</a></div>
<div id="tab">Overview of a made-up player</div></main><script>${script}</script></body></html>`;
}

/** The made-up lpga.com *Results* page: the head and the standing at once, the season's table a moment later. */
function lpgaResultsPage(): string {
  const fig = (v: string, label: string) => `<div><div>${v}</div><div>${label}</div></div>`;
  const row = (date: string, slug: string, name: string, pos: string, r: string[], pts: string) =>
    `<tr><th><div><div>${date}</div><a href="/tournaments/${slug}/overview"><span>${name}</span></a></div></th><td><p>${pos}</p></td><td><p>-1</p></td><td><p>$0</p></td>${r.map((x) => `<td><p>${x}</p></td>`).join('')}<td><p>${r.filter((x) => x !== '-').reduce((a, b) => a + Number(b), 0)}</p></td><td><p>${pts}</p></td></tr>`;
  const head = ['TOURNAMENT', 'POS', 'TO PAR', 'OFFICIAL MONEY', 'R1', 'R2', 'R3', 'R4', 'TOTAL', 'CME POINTS'];
  const table = `<table><thead><tr>${head.map((h) => `<th><p>${h}</p></th>`).join('')}</tr></thead><tbody><div>${[
    row('07/23/2026', 'made-up-links-open', 'Made-up Links Open', 'T44', ['77', '70', '74', '77'], '9.07'),
    row('06/11/2026', 'dow-championship', 'Dow Championship', 'T30', ['70', '67', '74', '66'], '3.70'),
  ].join('')}</div></tbody></table>`;
  return `<!doctype html><html><head><title>Lena Ausgedacht | Results | LPGA (made up)</title></head><body>
<ul><li>Leaderboard</li><li>Schedule</li></ul>
<main><h1><span>Lena</span><span>Ausgedacht</span></h1><div><div>143</div></div>
<div><p>Seasons</p><div><div>2026</div></div></div>
<h2>Race to CME Globe</h2><div>${fig('134', 'CME Points Rank')}${fig('134', 'CME Points Rank Previous')}${fig('63.688', 'CME Points')}${fig('3,980.187', 'CME Points Behind')}</div>
<div id="season">…</div></main>
<script>setTimeout(() => { document.getElementById('season').innerHTML = ${JSON.stringify(table)}; }, 700);</script></body></html>`;
}

/**
 * The made-up lpga.com *Stats* page: the season picker and the strokes gained cards at once (a label, its value after
 * it), the table *PERFORMANCE, YEAR TO DATE, RANKING* a moment later, its labels as row headers.
 */
function lpgaStatsPage(): string {
  const card = (label: string, value: string) => `<div><div><div>${label}</div><button><img alt=""></button></div><div>${value}</div><div><p>40</p></div></div>`;
  const row = (label: string, value: string, rank: string) => `<tr><th><p>${label}</p></th><td><p>${value}</p></td><td><p>${rank}</p></td></tr>`;
  const table = `<h2>Top Stats</h2><table><thead><tr>${['PERFORMANCE', 'YEAR TO DATE', 'RANKING'].map((h) => `<th><p>${h}</p></th>`).join('')}</tr></thead><tbody><div>${[
    row('Official Money', '$412,000', '61'),
    row('CME Points', '1,021.500', '57'),
    row('Drive Distance Avg', '255.40', '88'),
    row('Greens in Regulation Pct', '70.02 %', '41'),
    row('Scoring Avg Per Round', '71.02', '39'),
    row('Birdies', '240', '50'),
    row('Rounds Played', '75', '30'),
    row('Cuts Made', '17', '20'),
  ].join('')}</div></tbody></table>`;
  return `<!doctype html><html><head><title>Lena Ausgedacht | Statistics | LPGA (made up)</title></head><body>
<main><h1><span>Lena</span><span>Ausgedacht</span></h1>
<div><p>Seasons</p><div><div>2026</div></div></div>
<h2>Strokes Gained Insights</h2><div>${card('SG Total', '0.41')}${card('SG Putting', '0.36')}</div>
<div id="season">…</div></main>
<script>setTimeout(() => { document.getElementById('season').innerHTML = ${JSON.stringify(table)}; }, 700);</script></body></html>`;
}

/** The made-up LET Access Series' players list: where she finds her profile. */
export const LETAS_PLAYERS = 'https://letaccess.com/players';

/**
 * The made-up LET Access Series: one app for every address, as the site is - a link changes the address without loading a
 * page, and what a page shows comes a moment after (put in by the page's script). Her profile with the season's results
 * (rounds in one cell, the total with its score to par), and the Order of Merit with her and two made-up players.
 */
function letasPage(): string {
  const result = (code: string, name: string, date: string, pos: string, r: number[], par: string) =>
    `<tr><td><li><a href="/tournaments-information/${code}/2026">${name}</a></li></td><td>${date}</td><td>${pos}</td><td><span>${r.join(' ')}</span></td><td>${r.reduce((a, b) => a + b, 0)} (${par})</td><td>1,000.00</td><td></td></tr>`;
  const profile = `<h3>Erika Erfunden <img alt=""></h3><h3>17 <span>Tournaments Played</span></h3><h3>0 <span>Wins</span></h3>
<h3>LETAS Results</h3><select><option selected>2026 Season</option><option>2025 Season</option></select>
<table><thead><tr>${['Tournaments', 'Date', 'Position', 'Rounds', 'Total', 'Prize Money', 'Points'].map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>
${result('9001', 'Sample Ladies Open', '12/04/26', '2', [72, 69, 69], '-6')}${result('9003', 'Beispiel Open', '08/07/26', '53=', [70, 75], '+1')}</tbody></table>`;
  const oomLine = (pos: string, name: string, id: string, points: string, played: string) =>
    `<tr><td>${pos}</td><td><a href="/player-profiles/${id}">${name}</a></td><td></td><td>${points}</td><td>${played}</td><td><a href="/player-profiles/${id}">&gt;</a></td></tr>`;
  const oom = `<h3>Anna Ausgedacht</h3><h3>12 <span>Tournaments Played</span></h3><select><option selected>2026 Season</option></select>
<table><thead><tr>${['Pos', 'Name', 'Nat', 'Points', 'Played', ''].map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>
${oomLine('1', 'Anna Ausgedacht (FRA)', '990010', '2,145.14', '17')}${oomLine('2', 'Berta Beispiel (SWE)', '990011', '1,885.25', '12')}${oomLine('3', 'Erika Erfunden (SUI)', '990001', '1,807.42', '18')}</tbody></table>`;
  const players = `<table><thead><tr><th>Name</th><th>Nationality</th><th>Instagram</th></tr></thead><tbody>
<tr><td><a href="/player-profiles/990010/">Anna Ausgedacht</a></td><td></td><td>-</td></tr><tr><td><a href="/player-profiles/990001/">Erika Erfunden</a></td><td></td><td>-</td></tr></tbody></table>`;
  const views = { profile, oom, players };
  return `<!doctype html><html><head><title>Letaccess</title></head><body>
<nav><a href="/players">Players</a> <a href="/letas-order-of-merits?id=2026&oom=LO">Order of Merit</a></nav><main id="app">…</main>
<script>
const views = ${JSON.stringify(views)};
function show() {
  const p = location.pathname;
  const v = p.replace(/[/]$/, '') === '/player-profiles/990001' ? views.profile : p.startsWith('/letas-order-of-merits') ? views.oom : p === '/players' ? views.players : '<h1>LET Access Series (made up)</h1>';
  document.getElementById('app').innerHTML = '…';
  setTimeout(() => { document.getElementById('app').innerHTML = v; }, 600);
}
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a || a.origin !== location.origin) return;
  e.preventDefault();
  history.pushState(null, '', a.href);
  show();
});
show();
</script></body></html>`;
}

export const ALPS_HOME = 'https://www.alpstourgolf.com/';

/**
 * The made-up Alps Tour: one app for every address (it changes its address without loading a page), the start page
 * with the Order of Merit, Paul Platzhalter's profile (TST001) with its reports picked in *Select Report*.
 */
function alpsPage(): string {
  const table = (head: string[], rows: string[][]) =>
    `<table><thead><tr>${head.map((h) => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  const reports: Record<string, string> = {
    'Statistics': table(['Description', 'Seasons', 'Tournaments', 'Result'], [['Stroke Average', '2', '23', '70.41']]),
    'Results': `<button>2026</button>${table(['Date', 'Name', 'Pos', 'Score', 'Par', 'Winnings (EUR)'], [['17/02/26', 'Sample Desert Open', '6=', '209', '-7', '1,507.50'], ['22/02/26', 'Made-up Lagoon Open', '51=', '141', '-3', '0.00']])}`,
    'Order of Merit': table(['Season Name', 'Pos', 'Points', 'Tournament'], [['2026 Season', '4', '26,845.35', '9']]),
    'This Season record': table(['Date', 'Name', 'Pos', 'Rounds', 'Score', 'Winnings (EUR)'], [['17/02/26', 'Sample Desert Open', '6=', '69 67 73', '209', '1,507.50'], ['22/02/26', 'Made-up Lagoon Open', '51=', '70 71', '141', '0.00']]),
  };
  const profile = `<div><div><div>Paul Platzhalter</div><img alt=""></div><div><h3>Represents</h3><div><h3></h3></div></div><div><h3>Age</h3><h3>27</h3></div></div>
<h3>Select Report <select id="report">${Object.keys(reports).map((r) => `<option>${r}</option>`).join('')}</select></h3><div id="report-body"></div>`;
  const home = `<h1>Alps Tour Golf Order of Merit</h1><ol><li>1 <a href="/playerprofile/OTH001">Otto Erfunden</a> 43,821.32</li><li>4 <a href="/playerprofile/TST001">Paul Platzhalter</a> 26,845.35</li></ol>`;
  return `<!doctype html><html><head><title>Alps Tour Golf (made up)</title></head><body><main id="app">…</main>
<script>
const views = ${JSON.stringify({ profile, home })};
const reports = ${JSON.stringify(reports)};
function report() {
  const body = document.getElementById('report-body');
  if (!body) return;
  body.innerHTML = '';
  setTimeout(() => { body.innerHTML = reports[document.getElementById('report').value]; }, 400);
}
function show() {
  const v = location.pathname === '/playerprofile/TST001' ? views.profile : views.home;
  document.getElementById('app').innerHTML = '…';
  setTimeout(() => { document.getElementById('app').innerHTML = v; report(); }, 600);
}
document.addEventListener('change', (e) => { if (e.target.id === 'report') report(); });
document.addEventListener('click', (e) => {
  const a = e.target.closest('a');
  if (!a || a.origin !== location.origin) return;
  e.preventDefault();
  history.pushState(null, '', a.href);
  show();
});
show();
</script></body></html>`;
}

export function pairUrl(target = TARGET, code = CODE): string {
  return `${WEB}/pair#target=${encodeURIComponent(target)}&code=${code}`;
}

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.json': 'application/json' };

function canonical(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) out[k.toLowerCase().replace(/(^|-)([a-z])/g, (_, d: string, c: string) => d + c.toUpperCase())] = v;
  return out;
}

const CORS = {
  'access-control-allow-origin': '*',
  // As a target that offers test scenarios to browser clients allows it (spec/test-mode.md).
  'access-control-allow-headers': 'Authorization, Content-Type, X-Test-Code',
  'access-control-allow-methods': 'GET, POST, DELETE, OPTIONS',
};

/** Answers a request with a fake's `fetch` (the target API, Trackman's GraphQL). */
async function answer(route: Route, fetchImpl: FetchLike): Promise<void> {
  const req = route.request();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
  const body = req.postData();
  try {
    const res = await fetchImpl(req.url(), { method: req.method(), headers: canonical(await req.allHeaders()), ...(body !== null ? { body } : {}) });
    const retry = res.headers.get('Retry-After');
    return route.fulfill({ status: res.status, body: await res.text(), headers: { 'content-type': 'application/json', ...CORS, ...(retry ? { 'retry-after': retry } : {}) } });
  } catch {
    return route.abort('connectionfailed');
  }
}

export interface Portal {
  /** The key the made-up portal holds (null: signed out). */
  token: string | null;
  /**
   * Where it keeps it: in storage, only in its calls to the API, or - `late` - in storage only `lateMs` after the
   * page loaded, with no call the extension's hooks see (coming back from the sign-in, the portal exchanges its
   * code on its own time: 18 Nov).
   */
  mode: 'storage' | 'fetch' | 'late';
  lateMs?: number;
}

/** The made-up golf.de: the player's record (made-up, with made-up names), and every request that reached its API. */
export class GolfDe {
  signedIn = true;
  readonly own = entry({ resultGuid: 'c0ffee00-0000-4000-8000-0000000e2e01' });
  nodes = [this.own, entry({ tournamentDate: '2026-09-12T10:00:00+02:00', ratedGrossResult: 88 }), entry({ tournamentType: 8, tournamentName: 'RPR: Max Markersmann', tournamentDate: '2026-08-02T10:00:00+02:00' })];
  /**
   * The pages as golf.de's are built (spec/hcp.md, clicking for the player): the History Sheet a web component with an
   * open shadow root, ten entries a page with its pager's links (`#/??first=10&after=<cursor>`) and the Scoring Record
   * behind its button; the result list by `#/<tournament>/ergebnisse` on one page. Off: every page loads it all at
   * once (the reading-along checks).
   */
  built = false;
  /**
   * The tournament calendar's pages show one tournament (spec 1.19.0, *Taking one tournament*): golf.de's page of a
   * tournament as made up in provider-golfde/testing (its lines a moment after the page), whatever its `#/…` says - a
   * client goes by the address. `title` other than golf.de's: a page golf.de changed. Off: the result list's page.
   */
  tournament: { title?: string } | null = null;
  /**
   * The page's GraphQL client as golf.de's reports have it since dgv-reports-js 1.23 (urql): a GET with the operation in
   * the address, an AbortSignal, the answer read with `text()` and the request aborted right after; the answers come as
   * `application/graphql-response+json`. Off: a POST with the operation in its body, never aborted.
   */
  urql = false;
  readonly apiSaw: { url: string; op: string | null; page: boolean }[] = [];

  /** golf.de's API, as the page's own requests reach it. */
  answer(url: string, body: string | null): unknown {
    const ask = body ? (JSON.parse(body) as { operationName?: string; variables?: { after?: string | null } }) : null;
    const op = ask?.operationName ?? GolfDe.opInAddress(url);
    if (!this.signedIn && op) return { data: null, errors: [{ message: 'no', extensions: { code: 'AUTH_FAILED' } }] };
    if (op === 'GetMemberDetails') return memberAnswer();
    if (op === 'GetHandicapHistorySheet') {
      if (!this.built) return historyAnswer(this.nodes, this.nodes.length);
      const after = ask?.variables?.after;
      const from = after ? Number(/^cursor:(\d+)$/.exec(atob(after))?.[1] ?? 0) : 0;
      return historyAnswer(this.nodes.slice(from, from + 10), this.nodes.length, from / 10 + 1, Math.ceil(this.nodes.length / 10));
    }
    if (op === 'GetScoringRecords') return scoringAnswer(this.built ? this.nodes.slice(0, 20) : [this.own]);
    const list = /\/v1\.0\/tournaments\/(\d+)\/results/.exec(url)?.[1];
    const mine = this.nodes.find((n) => String(n.scorecardTournamentNumber) === list && n.tournamentType !== 8);
    if (mine) return resultsAnswer(mine.resultGuid as string);
    return { errors: [{ message: 'unknown' }] };
  }

  /** The operation a GET names in its address (as urql sends a query). */
  static opInAddress(url: string): string | null {
    try {
      return new URL(url).searchParams.get('operationName');
    } catch {
      return null;
    }
  }

  /** A made-up page of *Mein Bereich* or the result list: it asks golf.de's API itself, as golf.de's page does. */
  page(path: string): string {
    if (this.tournament && path.startsWith('/sport/turnierkalender/')) {
      const html = tournamentHtml();
      return this.tournament.title ? html.replaceAll('Turnierinformationen', this.tournament.title) : html;
    }
    const header = JSON.stringify({ 'content-type': 'application/json', 'x-client-id': 'made-up-page-client-id', [GOLFDE_PAGE_HEADER]: '1' });
    if (this.built) return this.builtPage(path, header);
    const urqlHeader = JSON.stringify({ accept: 'application/graphql-response+json, application/graphql+json, application/json, text/event-stream, multipart/mixed', 'x-client-id': 'made-up-page-client-id', [GOLFDE_PAGE_HEADER]: '1' });
    const gql = (op: string) =>
      this.urql
        ? `(() => { const c = new AbortController(); return fetch('https://api-v2.golf.de/graphql?query=' + encodeURIComponent('query ${op} { me { id } }') + '&operationName=${op}&variables=%7B%7D', { method: 'GET', credentials: 'include', headers: ${urqlHeader}, signal: c.signal }).then((r) => r.text()).then((t) => { c.abort(); return JSON.parse(t); }); })()`
        : `fetch('https://api-v2.golf.de/graphql', { method: 'POST', credentials: 'include', headers: ${header}, body: JSON.stringify({ operationName: '${op}', query: 'query ${op} { me { id } }', variables: {} }) })`;
    const calls = path.startsWith('/sport/')
      ? `fetch('https://api-v2.golf.de/v1.0/tournaments/5001/results', { headers: ${header} })`
      : `${gql('GetMemberDetails')}.then(() => ${gql('GetHandicapHistorySheet')}).then(() => ${gql('GetScoringRecords')})`;
    return `<!doctype html><html><head><title>golf.de (made up)</title></head><body><h1>Made-up golf.de</h1><p>Alexandra Beispielspielerin</p><script>${calls};</script></body></html>`;
  }

  private builtPage(path: string, header: string): string {
    const head = `const H = ${header}; const gql = (op, variables = {}) => fetch('https://api-v2.golf.de/graphql', { method: 'POST', credentials: 'include', headers: H, body: JSON.stringify({ operationName: op, query: 'query ' + op + ' { me { id } }', variables }) }).then((r) => r.json());`;
    const script = path.startsWith('/sport/')
      ? `${head}
        const load = () => { const m = /^#\\/(\\d+)\\/ergebnisse$/.exec(location.hash); if (m) fetch('https://api-v2.golf.de/v1.0/tournaments/' + m[1] + '/results', { headers: H }); };
        load(); window.addEventListener('hashchange', load);`
      : `${head}
        const host = document.createElement('my-handicap-history-sheet'); document.body.append(host);
        const root = host.attachShadow({ mode: 'open' });
        const after = () => { const m = /[?&]after=([^&]*)/.exec(location.hash); return m ? decodeURIComponent(m[1]) : null; };
        const load = () => gql('GetHandicapHistorySheet', { first: 10, after: after() }).then((a) => {
          const info = a.data.me.reports.handicapHistorySheet.pageInfo;
          root.replaceChildren();
          for (const c of info.forwardCursors) { const l = document.createElement('a'); l.href = '#/??first=10&after=' + encodeURIComponent(c.cursor); l.textContent = String(c.page); root.append(l); }
          const b = document.createElement('button'); b.textContent = 'Scoring Record'; b.addEventListener('click', () => gql('GetScoringRecords')); root.append(b);
        });
        gql('GetMemberDetails').then(load); window.addEventListener('hashchange', load);`;
    return `<!doctype html><html><head><title>golf.de (made up)</title></head><body><h1>Made-up golf.de</h1><p>Alexandra Beispielspielerin</p><script>${script}</script></body></html>`;
  }
}

export class World {
  readonly tm = new FakeTrackman();
  readonly target = new FakeTarget({ base: TARGET });
  readonly hcp = new FakeHcpTarget({ base: HCP_TARGET });
  readonly golfde = new GolfDe();
  readonly pro = new FakeProTarget({ base: PRO_TARGET });
  /** Every request that reached owgr.com: only the pages the player opened, never one of the extension's. */
  readonly owgrSaw: { url: string; type: string }[] = [];
  /** Every request that reached progolftour.de: only the pages opened (by the player, or by Fetch all as its links do). */
  readonly pgtSaw: { url: string; type: string }[] = [];
  /** Every request that reached europeantour.com: only the pages the player opened. */
  readonly etSaw: { url: string; type: string }[] = [];
  /** Every request that reached pgatour.com or lpga.com: only the pages the player opened. */
  readonly seasonSaw: { url: string; type: string }[] = [];
  /** Every request that reached letaccess.com: only the one page the player opened (the site changes pages itself). */
  readonly letasSaw: { url: string; type: string }[] = [];
  /** Every request that reached alpstourgolf.com: only the one page the player opened. */
  readonly alpsSaw: { url: string; type: string }[] = [];
  readonly portal: Portal = { token: null, mode: 'storage' };
  /** How often Trackman's sign-out page was opened. */
  signOuts = 0;

  constructor() {
    this.tm.profile = { fullName: 'Alex Example' };
    this.tm.activities = [
      { id: 'S2', time: '2026-11-15T17:00:00Z', kind: 'RANGE_PRACTICE', location: { name: 'Example Range' } },
      { id: 'S1', time: '2026-11-12T17:00:00Z', kind: 'SIMULATOR' },
    ];
    for (const a of this.tm.activities) {
      this.tm.nodes.set(String(a.id), { strokes: [{ club: 'Iron7', time: a.time, measurement: { carry: 140, ballSpeed: 50 } }, { club: 'Driver', time: a.time, measurement: { carry: 210, ballSpeed: 68 } }] });
    }
  }

  /** A key for `sub`, good for a week, that the made-up Trackman takes. */
  key(sub = 'player-0001', hours = 24 * 7): string {
    const t = fakeToken(sub, { exp: Math.round(Date.now() / 1000 + hours * 3600), iss: 'https://login.trackmangolf.com' });
    this.tm.tokens.add(t);
    return t;
  }

  /** The made-up portal: a page that keeps its key in storage, or sends it with its first call. */
  private portalPage(): string {
    const token = JSON.stringify(this.portal.token);
    const store = `localStorage.setItem('session', JSON.stringify({ user: { access_token: ${token} } }))`;
    const script =
      this.portal.mode === 'storage'
        ? `if (${token}) ${store}; else localStorage.clear();`
        : this.portal.mode === 'late'
          ? `localStorage.clear(); if (${token}) setTimeout(() => ${store}, ${this.portal.lateMs ?? 6000});`
          : `localStorage.clear(); if (${token}) fetch('https://api.trackmangolf.com/graphql', { method: 'POST', headers: { Authorization: 'Bearer ' + ${token}, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: 'query Profile { me { profile { fullName } } }' }) });`;
    return `<!doctype html><html><head><title>Portal</title></head><body><h1>Made-up portal</h1><script>${script}</script></body></html>`;
  }

  /** What the made-up FSX Live saw (the shape recorder's portal): every request, by method, path and resource type. */
  readonly shapeSaw: { method: string; path: string; type: string }[] = [];

  /**
   * The made-up FSX Live: a page whose own script keeps a made-up sign-in in storage, fetches the list of sessions and
   * then, with XMLHttpRequest, the profile, and shows what it got (so a check can see the page still works with the
   * recorder reading along). Everything in it is invented (@glmsync/shape's testing).
   */
  private shapePortalPage(): string {
    const script = `
      localStorage.setItem('auth', JSON.stringify({ accessToken: ${JSON.stringify(SHAPE_ACCESS)}, user: { email: ${JSON.stringify(SHAPE_PERSON.email)} } }));
      document.cookie = 'theme=dark; path=/';
      fetch('/api/v1/players/${SHAPE_PERSON.slug}/sessions?page=1', { headers: { Authorization: 'Bearer ${SHAPE_ACCESS}' } })
        .then((r) => r.json())
        .then((d) => {
          document.getElementById('count').textContent = d.items.length + ' sessions';
          const x = new XMLHttpRequest();
          x.open('GET', '/api/v1/profile');
          x.setRequestHeader('Authorization', 'Bearer ${SHAPE_ACCESS}');
          x.onload = () => { document.getElementById('who').textContent = JSON.parse(x.responseText).displayName; };
          x.send();
        });`;
    return `<!doctype html><html><head><title>FSX Live (made up)</title></head><body><h1>Made-up FSX Live</h1><p id="count"></p><p id="who"></p><script>${script}</script></body></html>`;
  }

  async route(context: BrowserContext): Promise<void> {
    // Anything not answered below never reaches a network (Playwright tries the routes added last first).
    await context.route((url) => url.protocol === 'http:' || url.protocol === 'https:', (route) => route.abort('blockedbyclient'));
    await context.route(`${WEB}/**`, (route) => {
      const path = new URL(route.request().url()).pathname.replace(/^\/golf-launch-monitor-sync/, '') || '/';
      let file = path.endsWith('/') ? `${path}index.html` : path;
      if (!extname(file)) file += '.html';
      const full = normalize(join(WEB_DIST, file));
      if (!full.startsWith(WEB_DIST) || !existsSync(full)) return route.fulfill({ status: 404, body: 'not found' });
      return route.fulfill({ status: 200, body: readFileSync(full), headers: { 'content-type': TYPES[extname(full)] ?? 'application/octet-stream' } });
    });
    await context.route('https://portal.trackmangolf.com/**', (route) => route.fulfill({ status: 200, body: this.portalPage(), headers: { 'content-type': 'text/html' } }));
    // Trackman's sign-out (made up: a page that says the player is signed out).
    await context.route('https://login.trackmangolf.com/**', (route) => {
      this.signOuts += 1;
      return route.fulfill({ status: 200, body: '<!doctype html><title>Signed out</title><p>You are signed out.</p>', headers: { 'content-type': 'text/html' } });
    });
    await context.route(`${GRAPHQL_URL}*`, (route) => answer(route, this.tm.fetch));
    await context.route('https://app.example.org/**', (route) => {
      const path = new URL(route.request().url()).pathname;
      if (path.startsWith('/lm/v1')) return answer(route, this.target.fetch);
      if (path.startsWith('/hcp/v1')) return answer(route, this.hcp.fetch);
      if (path.startsWith('/pro/v1')) return answer(route, this.pro.fetch);
      return route.fulfill({ status: 200, body: '<!doctype html><html><head><title>Example App</title></head><body><h1>Example App</h1></body></html>', headers: { 'content-type': 'text/html' } });
    });
    // The made-up FSX Live (the shape recorder's portal): its page and its API on the same site.
    await context.route('https://performance.foresightsports.com/**', (route) => {
      const req = route.request();
      const path = new URL(req.url()).pathname;
      this.shapeSaw.push({ method: req.method(), path, type: req.resourceType() });
      const json = (v: unknown) => route.fulfill({ status: 200, body: JSON.stringify(v), headers: { 'content-type': 'application/json' } });
      if (path.endsWith('/sessions')) return json(SESSIONS_ANSWER);
      if (path === '/api/v1/profile') return json(PROFILE_ANSWER);
      return route.fulfill({ status: 200, body: this.shapePortalPage(), headers: { 'content-type': 'text/html' } });
    });
    // The made-up OWGR: a player's page, and its ranking (where the player searches for their page).
    await context.route('https://www.owgr.com/**', (route) => {
      const req = route.request();
      this.owgrSaw.push({ url: req.url(), type: req.resourceType() });
      const path = new URL(req.url()).pathname;
      const body = path.startsWith('/playerprofile/') ? owgrPage() : '<!doctype html><title>Official World Golf Ranking - Ranking</title><h1>World ranking (made up)</h1>';
      return route.fulfill({ status: 200, body, headers: { 'content-type': 'text/html' } });
    });
    // The made-up Pro Golf Tour: a player's profile and two tournaments' pages.
    await context.route('https://www.progolftour.de/**', (route) => {
      const req = route.request();
      this.pgtSaw.push({ url: req.url(), type: req.resourceType() });
      const path = decodeURIComponent(new URL(req.url()).pathname);
      const body = path.startsWith('/player-profile/') ? pgtProfilePage() : path.startsWith('/tournament-details/') ? pgtResultPage(path.slice(20)) : '<!doctype html><title>PGT</title><h1>Pro Golf Tour (made up)</h1>';
      return route.fulfill({ status: 200, body, headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    // The made-up europeantour.com: a player's results page.
    await context.route('https://www.europeantour.com/**', (route) => {
      const req = route.request();
      this.etSaw.push({ url: req.url(), type: req.resourceType() });
      const path = new URL(req.url()).pathname;
      const body = path.startsWith('/players/') ? etResultsPage() : '<!doctype html><title>Players - DP World Tour</title><h1>Players (made up)</h1>';
      return route.fulfill({ status: 200, body, headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    // The made-up pgatour.com and lpga.com: a player's pages (the rest of the sites: a plain page).
    await context.route('https://www.pgatour.com/**', (route) => {
      const req = route.request();
      this.seasonSaw.push({ url: req.url(), type: req.resourceType() });
      const path = new URL(req.url()).pathname;
      const body = path.startsWith('/player/99002/') ? pgaPlayerPage(path) : '<!doctype html><title>PGA Tour (made up)</title><h1>PGA Tour (made up)</h1>';
      return route.fulfill({ status: 200, body, headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    await context.route('https://www.lpga.com/**', (route) => {
      const req = route.request();
      this.seasonSaw.push({ url: req.url(), type: req.resourceType() });
      const path = new URL(req.url()).pathname;
      const body = path.endsWith('/results') ? lpgaResultsPage() : path.endsWith('/stats') ? lpgaStatsPage() : '<!doctype html><title>LPGA (made up)</title><h1>LPGA (made up)</h1>';
      return route.fulfill({ status: 200, body, headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    // The made-up LET Access Series: one app for every address.
    await context.route('https://letaccess.com/**', (route) => {
      const req = route.request();
      this.letasSaw.push({ url: req.url(), type: req.resourceType() });
      return route.fulfill({ status: 200, body: letasPage(), headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    // The made-up Alps Tour: one app for every address.
    await context.route('https://www.alpstourgolf.com/**', (route) => {
      const req = route.request();
      this.alpsSaw.push({ url: req.url(), type: req.resourceType() });
      return route.fulfill({ status: 200, body: alpsPage(), headers: { 'content-type': 'text/html; charset=utf-8' } });
    });
    // The made-up golf.de: its pages, and its API as the pages' own requests reach it.
    await context.route('https://www.golf.de/**', (route) => route.fulfill({ status: 200, body: this.golfde.page(new URL(route.request().url()).pathname), headers: { 'content-type': 'text/html' } }));
    await context.route('https://api-v2.golf.de/**', async (route) => {
      const req = route.request();
      const cors = { 'access-control-allow-origin': 'https://www.golf.de', 'access-control-allow-credentials': 'true', 'access-control-allow-headers': `accept, content-type, x-client-id, ${GOLFDE_PAGE_HEADER}`, 'access-control-allow-methods': 'GET, POST, OPTIONS' };
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors });
      const body = req.postData();
      const headers = await req.allHeaders();
      this.golfde.apiSaw.push({ url: req.url(), op: body ? ((JSON.parse(body) as { operationName?: string }).operationName ?? null) : GolfDe.opInAddress(req.url()), page: headers[GOLFDE_PAGE_HEADER] === '1' });
      const type = this.golfde.urql ? 'application/graphql-response+json; charset=utf-8' : 'application/json';
      return route.fulfill({ status: 200, body: JSON.stringify(this.golfde.answer(req.url(), body)), headers: { 'content-type': type, ...cors } });
    });
  }

  /**
   * The made-up target's account becomes a test account with a scenario for `TEST_CODE` (made up: `sessions`
   * sessions every three days back from yesterday, one round), and the target plans as a real one does: the
   * regular sync over the last three days, the older history in chunks of `chunk` sessions.
   */
  testAccount(sessions = 7, chunk = 2): Record<string, unknown> {
    const now = Date.now();
    const activities = Array.from({ length: sessions }, (_, i) => ({
      __typename: i % 2 ? 'SimulatorSessionActivity' : 'RangePracticeActivity',
      id: `L${i}`,
      time: new Date(now - DAY - i * 3 * DAY).toISOString(),
      kind: i % 2 ? 'SIMULATOR' : 'RANGE_PRACTICE',
    }));
    const nodes = Object.fromEntries(activities.map((a, i) => [a.id, { strokes: [{ club: 'Driver', time: a.time, measurement: { carry: 240 + i, ballSpeed: 74 } }] }]));
    const hole = { holeNumber: 1, pinPosition: { x: 10, z: 20 }, shots: [{ shotNumber: 1, club: 'Driver', launchLie: 'Tee', finalLie: 'Fairway', launchPosition: { x: 10, z: 400 }, finalPosition: { x: 12, z: 160 } }] };
    const scenario = {
      name: 'Leon, never switched',
      provider: 'trackman',
      subject: TEST_SUBJECT,
      profile: { fullName: 'Leon (Test T17)' },
      data: { activities, nodes, scorecards: [{ id: 'R1', startedAt: new Date(now - 2 * DAY).toISOString(), course: { displayName: 'Example Links' }, par: 72, grossScore: 80 }], shotHoles: { R1: [hole] } },
      latency: { default: { median_s: 0, spread_s: 0 }, queries: {} },
      valid_until: new Date(now + 7 * DAY).toISOString(),
    };
    this.target.testAccount = true;
    this.target.scenarios.set(TEST_CODE, scenario);
    (this.target.opts as { plan?: (ask: PlanAsked, t: FakeTarget) => Record<string, unknown> }).plan = (ask, t) => {
      const done = t.imports.some((b) => b.sync?.reason === 'backfill' && b.progress?.more_available === false);
      const base = { plan_id: `pl_${t.imports.length}_${ask.reason}`, known_ids: t.known() };
      if (ask.reason === 'backfill') return done ? { due: false, history: { done: true } } : { ...base, due: true, since: '2011-01-01T00:00:00Z', max_sessions: chunk, rounds: true, round_shots: false, history: { done: false } };
      return { ...base, due: true, since: new Date(Date.now() - 3 * DAY).toISOString(), max_sessions: 40, rounds: true, round_shots: true, history: { done } };
    };
    return scenario;
  }

  /** Every request that reached the made-up target, as text: a Trackman key must never be in it. */
  targetSaw(): string {
    return JSON.stringify(this.target.received);
  }
}
