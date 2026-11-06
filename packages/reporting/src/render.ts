import type { Counts, GroupRow, HistoryEntry, Outcome, ReleaseStatus, RunModel, TestRow } from './model';

/**
 * Renders the stakeholder report: one self-contained HTML file (inline CSS, SVG and a small script).
 * Charts are drawn at generation time, so the page reads fine offline, printed, or with scripts off;
 * the script only adds tooltips and the theme toggle.
 */

const esc = (s: unknown) =>
  String(s ?? '').replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!,
  );

const pct = (n: number | null, digits = 1) => (n === null ? 'n/a' : `${(n * 100).toFixed(digits)}%`);

const fmtDuration = (ms: number) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m} min ${s % 60} s` : `${Math.floor(m / 60)} h ${m % 60} min`;
};

const utc = (iso: string) => `${iso.slice(0, 16).replace('T', ' ')} UTC`;

/** Status meaning is never carried by colour alone: every use has an icon and a word. */
const OUTCOME: Record<Outcome, { icon: string; word: string }> = {
  passed: { icon: '✓', word: 'passed' },
  flaky: { icon: '!', word: 'flaky' },
  failed: { icon: '✕', word: 'failed' },
  skipped: { icon: '–', word: 'skipped' },
};
const ORDER: Outcome[] = ['passed', 'flaky', 'failed', 'skipped'];

const RELEASE: Record<ReleaseStatus, { icon: string; label: string; cls: string }> = {
  ready: { icon: '✓', label: 'Ready to release', cls: 'st-good' },
  'at-risk': { icon: '!', label: 'At risk', cls: 'st-warn' },
  'not-ready': { icon: '✕', label: 'Not ready', cls: 'st-crit' },
  'no-results': { icon: '–', label: 'No results', cls: 'st-none' },
};

function countsText(c: Counts) {
  return ORDER.filter((o) => c[o] > 0)
    .map(
      (o) =>
        `<span class="cnt"><span class="key s-${o}" aria-hidden="true"></span>${OUTCOME[o].icon} ${c[o]} ${OUTCOME[o].word}</span>`,
    )
    .join('');
}

function ariaCounts(label: string, c: Counts) {
  return `${label}: ${ORDER.filter((o) => c[o] > 0)
    .map((o) => `${c[o]} ${OUTCOME[o].word}`)
    .join(', ')}`;
}

/** Tall segmented bar: one whole split into outcome parts, 2px surface gaps, icon + count inside when it fits. */
function segBar(label: string, c: Counts) {
  if (!c.total) return '<div class="seg empty">No tests</div>';
  const parts = ORDER.filter((o) => c[o] > 0)
    .map((o) => {
      const share = c[o] / c.total;
      const tip = `${c[o]} ${OUTCOME[o].word}\n${label} · ${pct(share, 0)} of ${c.total}`;
      // Narrow parts print nothing inside: the counts beside the bar, tooltip and table carry the value
      const inside = share >= 0.12 ? `${OUTCOME[o].icon} ${c[o]}` : '';
      return `<span class="part s-${o}" role="img" style="flex:${c[o]} 1 0" tabindex="0" data-tip="${esc(tip)}" aria-label="${esc(
        `${c[o]} ${OUTCOME[o].word}`,
      )}">${inside}</span>`;
    })
    .join('');
  return `<div class="seg" role="group" aria-label="${esc(ariaCounts(label, c))}">${parts}</div>`;
}

function groupSection(id: string, title: string, intro: string, rows: GroupRow[]) {
  if (!rows.length) return '';
  const body = rows
    .map(
      (r) => `<div class="grow">
  <div class="glabel"><div class="gname">${esc(r.label)}</div>${
    r.description ? `<div class="gdesc">${esc(r.description)}</div>` : ''
  }</div>
  <div class="gbar">${segBar(r.label, r.counts)}</div>
  <div class="gcounts"><span class="grate">${pct(passRateOf(r.counts), 0)}</span>${countsText(r.counts)}</div>
</div>`,
    )
    .join('');
  const table = `<details class="tableview"><summary>Table view</summary><table>
<thead><tr><th scope="col">${id === 'areas' ? 'Area' : 'Dimension'}</th><th scope="col" class="num">Tests</th>${ORDER.map(
    (o) => `<th scope="col" class="num">${OUTCOME[o].word[0]!.toUpperCase()}${OUTCOME[o].word.slice(1)}</th>`,
  ).join('')}<th scope="col" class="num">Pass rate</th></tr></thead>
<tbody>${rows
    .map(
      (r) =>
        `<tr><th scope="row">${esc(r.label)}</th><td class="num">${r.counts.total}</td>${ORDER.map(
          (o) => `<td class="num">${r.counts[o]}</td>`,
        ).join('')}<td class="num">${pct(passRateOf(r.counts))}</td></tr>`,
    )
    .join('')}</tbody></table></details>`;
  return `<section class="card" id="${id}" aria-labelledby="${id}-h">
<h2 id="${id}-h">${esc(title)}</h2><p class="intro">${esc(intro)}</p>
${legend()}
<div class="groups">${body}</div>${table}</section>`;
}

const passRateOf = (c: Counts) => {
  const executed = c.total - c.skipped;
  return executed ? (c.passed + c.flaky) / executed : null;
};

const legend = () =>
  `<ul class="legend" aria-label="Legend">${ORDER.map(
    (o) =>
      `<li><span class="key s-${o}" aria-hidden="true"></span>${OUTCOME[o].icon} ${OUTCOME[o].word[0]!.toUpperCase()}${OUTCOME[o].word.slice(1)}</li>`,
  ).join('')}</ul>`;

function delta(curr: number | null, prev: number | null | undefined, kind: 'rate' | 'failed') {
  if (curr === null || prev === null || prev === undefined) return '';
  const d = kind === 'rate' ? (curr - prev) * 100 : curr - prev;
  if (Math.abs(d) < (kind === 'rate' ? 0.05 : 1))
    return `<div class="delta flat">No change vs previous run</div>`;
  const up = d > 0;
  const good = kind === 'rate' ? up : !up;
  const amount = kind === 'rate' ? `${Math.abs(d).toFixed(1)} pts` : `${Math.abs(d)}`;
  return `<div class="delta ${good ? 'good' : 'bad'}">${up ? '▲' : '▼'} ${amount} ${
    kind === 'rate' ? (up ? 'higher' : 'lower') : up ? 'more' : 'fewer'
  } vs previous run</div>`;
}

function kpis(m: RunModel, prev?: HistoryEntry) {
  const c = m.counts;
  const executed = c.total - c.skipped;
  const tile = (label: string, value: string, extra = '', o?: Outcome) =>
    `<div class="tile"><div class="tlabel">${o ? `<span class="key s-${o}" aria-hidden="true"></span>` : ''}${esc(
      label,
    )}</div><div class="tvalue">${value}</div>${extra}</div>`;
  return `<section class="kpis" aria-label="Key figures">
<div class="tile hero"><div class="tlabel">Pass rate</div><div class="hvalue">${pct(m.passRate)}</div>
<div class="tsub">${c.passed + c.flaky} of ${executed} executed tests passed</div>${delta(m.passRate, prev?.passRate, 'rate')}</div>
<div class="tiles">
${tile('Tests', String(c.total), `<div class="tsub">${executed} executed</div>`)}
${tile(`${OUTCOME.passed.icon} Passed`, String(c.passed), '', 'passed')}
${tile(`${OUTCOME.failed.icon} Failed`, String(c.failed), delta(c.failed, prev?.counts.failed, 'failed'), 'failed')}
${tile(`${OUTCOME.flaky.icon} Flaky`, String(c.flaky), '<div class="tsub">passed on retry</div>', 'flaky')}
${tile(`${OUTCOME.skipped.icon} Skipped`, String(c.skipped), '', 'skipped')}
${tile('Duration', fmtDuration(m.durationMs))}
</div></section>`;
}

/** Single-series line (no legend: the title names it), 2px line, end dot with surface ring, crosshair tooltip. */
function trend(history: HistoryEntry[]) {
  const pts = history.map((h, i) => ({ ...h, i })).filter((h) => h.passRate !== null) as (HistoryEntry & {
    i: number;
    passRate: number;
  })[];
  if (pts.length < 2)
    return `<section class="card" aria-labelledby="trend-h"><h2 id="trend-h">Pass rate over recent runs</h2>
<p class="intro">The trend appears once there are two or more runs. ${pts.length} recorded so far.</p></section>`;

  const W = 720,
    H = 220,
    L = 44,
    R = 64,
    T = 16,
    B = 30;
  const min = Math.min(...pts.map((p) => p.passRate * 100));
  const step = 100 - min <= 20 ? 5 : 10;
  const lo = Math.max(0, Math.floor((min - 1) / step) * step);
  const n = history.length;
  const x = (i: number) => L + (n === 1 ? 0 : (i / (n - 1)) * (W - L - R));
  const y = (v: number) => T + ((100 - v) / (100 - lo)) * (H - T - B);
  const ticks: number[] = [];
  for (let v = lo; v <= 100; v += step) ticks.push(v);

  const grid = ticks
    .map(
      (v) =>
        `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text class="tick" x="${L - 8}" y="${
          y(v) + 4
        }" text-anchor="end">${v}%</text>`,
    )
    .join('');
  const path = pts
    .map((p, k) => `${k ? 'L' : 'M'}${x(p.i).toFixed(1)},${y(p.passRate * 100).toFixed(1)}`)
    .join('');
  const last = pts[pts.length - 1]!;
  const data = pts.map((p) => ({
    x: +x(p.i).toFixed(1),
    y: +y(p.passRate * 100).toFixed(1),
    v: pct(p.passRate),
    when: p.startedAt,
    fail: p.counts.failed,
    total: p.counts.total,
    ref: [p.branch, p.commit].filter(Boolean).join(' @ '),
  }));

  const rows = [...pts]
    .reverse()
    .map(
      (p) =>
        `<tr><td><time datetime="${esc(p.startedAt)}">${esc(utc(p.startedAt))}</time></td><td class="num">${pct(
          p.passRate,
        )}</td><td class="num">${p.counts.total}</td><td class="num">${p.counts.failed}</td><td>${esc(
          [p.branch, p.commit].filter(Boolean).join(' @ '),
        )}</td></tr>`,
    )
    .join('');

  return `<section class="card" aria-labelledby="trend-h"><h2 id="trend-h">Pass rate over recent runs</h2>
<p class="intro">Last ${n} runs, oldest on the left.</p>
<div class="chart"><svg id="trend" viewBox="0 0 ${W} ${H}" role="group" aria-label="Pass rate over the last ${n} runs, latest ${pct(
    last.passRate,
  )}">
${grid}<line class="axis" x1="${L}" x2="${W - R}" y1="${H - B}" y2="${H - B}"/>
<text class="tick" x="${L}" y="${H - 8}">Run 1</text><text class="tick" x="${W - R}" y="${H - 8}" text-anchor="end">Latest</text>
<path class="line" d="${path}"/>
<line id="cross" class="cross" x1="0" x2="0" y1="${T}" y2="${H - B}" visibility="hidden"/>
<circle id="hoverdot" class="dot" r="4" visibility="hidden"/>
<circle class="dot" cx="${x(last.i)}" cy="${y(last.passRate * 100)}" r="4"/>
<text class="endlabel" x="${x(last.i) + 10}" y="${y(last.passRate * 100) + 4}">${pct(last.passRate)}</text>
<rect id="trendhit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}" fill="transparent" tabindex="0" role="slider" aria-label="Pass rate by run. Use the arrow keys to move between runs" aria-valuemin="1" aria-valuemax="${pts.length}" aria-valuenow="${pts.length}" aria-valuetext="Latest run: ${pct(last.passRate)}"/>
</svg></div>
<script type="application/json" id="trend-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>
<details class="tableview"><summary>Table view</summary><table><thead><tr><th scope="col">Run</th><th scope="col" class="num">Pass rate</th><th scope="col" class="num">Tests</th><th scope="col" class="num">Failed</th><th scope="col">Branch @ commit</th></tr></thead><tbody>${rows}</tbody></table></details>
</section>`;
}

function testCard(t: TestRow, kind: 'failed' | 'flaky') {
  return `<li class="tcard"><div class="tchead"><span class="badge s-${kind}">${OUTCOME[kind].icon} ${OUTCOME[kind].word}</span><span class="area">${esc(
    t.area,
  )}</span></div>
<div class="tname">${esc(t.path || t.title)}</div>
${t.error ? `<div class="terr">${esc(t.error)}</div>` : ''}
<div class="tmeta">${esc(t.location)} · ${fmtDuration(t.durationMs)}${t.retries ? ` · ${t.retries} retr${t.retries === 1 ? 'y' : 'ies'}` : ''}</div></li>`;
}

function issues(m: RunModel) {
  const detail = m.detailReport
    ? `<p class="intro">Screenshots, videos and step-by-step traces are in the <a href="${esc(m.detailReport)}">detailed engineering report</a>.</p>`
    : '';
  const failures = m.failures.length
    ? `<ul class="tlist">${m.failures.map((t) => testCard(t, 'failed')).join('')}</ul>${detail}`
    : `<p class="none">${OUTCOME.passed.icon} No failures in this run.</p>`;
  const flaky = m.flaky.length
    ? `<section class="card" aria-labelledby="flaky-h"><h2 id="flaky-h">Flaky tests (${m.flaky.length})</h2>
<p class="intro">Failed first, then passed on retry. They count as passed but point to instability worth fixing.</p>
<ul class="tlist">${m.flaky.map((t) => testCard(t, 'flaky')).join('')}</ul></section>`
    : '';
  const skipped = m.skippedReasons.length
    ? `<section class="card" aria-labelledby="skip-h"><h2 id="skip-h">Not run (${m.counts.skipped})</h2>
<ul class="reasons">${m.skippedReasons.map((r) => `<li><span class="rcount">${r.count}</span> ${esc(r.reason)}</li>`).join('')}</ul></section>`
    : '';
  return `<section class="card" aria-labelledby="fail-h"><h2 id="fail-h">Failures (${m.failures.length})</h2>${failures}</section>${flaky}${skipped}`;
}

function allTests(m: RunModel) {
  const rows = m.tests
    .map(
      (t) =>
        `<tr><td>${esc(t.area)}</td><td>${esc(t.path || t.title)}</td><td><span class="key s-${t.outcome}" aria-hidden="true"></span>${
          OUTCOME[t.outcome].icon
        } ${OUTCOME[t.outcome].word}</td><td class="num">${fmtDuration(t.durationMs)}</td></tr>`,
    )
    .join('');
  return `<section class="card"><details><summary class="h2like">All tests (${m.tests.length})</summary>
<table class="alltests"><thead><tr><th scope="col">Area</th><th scope="col">Test</th><th scope="col">Result</th><th scope="col" class="num">Time</th></tr></thead><tbody>${rows}</tbody></table></details></section>`;
}

const CSS = `
.viz-root{color-scheme:light;--page:#f9f9f7;--surface-1:#fcfcfb;--ink:#0b0b0b;--ink-2:#52514e;--muted:#898781;--grid:#e1e0d9;--axis:#c3c2b7;--border:rgba(11,11,11,.10);
--text-muted:#6b6a66;--link:#1c5cab;--series-1:#2a78d6;--good:#0ca30c;--warn:#fab219;--crit:#d03b3b;--skip:#898781;--good-text:#006300;--crit-text:#b3261e;--wash:rgba(42,120,214,.10)}
@media (prefers-color-scheme:dark){:root:where(:not([data-theme="light"])) .viz-root{color-scheme:dark;--page:#0d0d0d;--surface-1:#1a1a19;--ink:#f0efec;--ink-2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);--text-muted:#a3a29a;--link:#6da7ec;--series-1:#3987e5;--good-text:#0ca30c;--crit-text:#e66767;--wash:rgba(57,135,229,.12)}}
:root[data-theme="dark"] .viz-root{color-scheme:dark;--page:#0d0d0d;--surface-1:#1a1a19;--ink:#f0efec;--ink-2:#c3c2b7;--muted:#898781;--grid:#2c2c2a;--axis:#383835;--border:rgba(255,255,255,.10);--text-muted:#a3a29a;--link:#6da7ec;--series-1:#3987e5;--good-text:#0ca30c;--crit-text:#e66767;--wash:rgba(57,135,229,.12)}
*{box-sizing:border-box}
body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;background:var(--page);color:var(--ink);line-height:1.45}
.wrap{max-width:1120px;margin:0 auto;padding:28px 20px 48px}
header.top{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;margin-bottom:18px}
h1{font-size:1.6rem;margin:0 0 4px}
h2,.h2like{font-size:1.1rem;font-weight:650;margin:0 0 4px}
.meta{color:var(--ink-2);font-size:.9rem;display:flex;flex-wrap:wrap;gap:4px 14px}
.meta b{color:var(--ink);font-weight:600}
a{color:var(--link)}
.btn{font:inherit;font-size:.85rem;border:1px solid var(--border);background:var(--surface-1);color:var(--ink);border-radius:8px;padding:6px 12px;cursor:pointer}
.card{background:var(--surface-1);border:1px solid var(--border);border-radius:12px;padding:20px 22px;margin-bottom:16px}
.intro{color:var(--ink-2);margin:0 0 14px;font-size:.92rem}
.status{display:flex;gap:16px;align-items:center}
.sicon{flex:none;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font-size:1.4rem;font-weight:700;color:#fff}
.st-good .sicon{background:var(--good);color:#0b0b0b}.st-warn .sicon{background:var(--warn);color:#0b0b0b}.st-crit .sicon{background:var(--crit)}.st-none .sicon{background:var(--skip);color:#0b0b0b}
.slabel{font-size:1.35rem;font-weight:700}
.sreason{color:var(--ink-2)}
.kpis{display:grid;grid-template-columns:minmax(220px,1fr) 3fr;gap:16px;margin-bottom:16px}
.tiles{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}
.tile{background:var(--surface-1);border:1px solid var(--border);border-radius:12px;padding:14px 16px}
.tlabel{color:var(--ink-2);font-size:.88rem;display:flex;align-items:center;gap:6px}
.tvalue{font-size:1.7rem;font-weight:650}
.hero{display:flex;flex-direction:column;justify-content:center}
.hvalue{font-size:3.4rem;font-weight:650;line-height:1.1}
.tsub{color:var(--text-muted);font-size:.82rem}
.delta{font-size:.82rem;margin-top:2px;font-weight:600}.delta.good{color:var(--good-text)}.delta.bad{color:var(--crit-text)}.delta.flat{color:var(--text-muted);font-weight:400}
.key{display:inline-block;width:10px;height:10px;border-radius:3px;flex:none;vertical-align:baseline;margin-right:6px}
.s-passed{background:var(--good)}.s-failed{background:var(--crit)}.s-flaky{background:var(--warn)}.s-skipped{background:var(--skip)}
.legend{list-style:none;display:flex;gap:16px;padding:0;margin:0 0 12px;color:var(--ink-2);font-size:.85rem;flex-wrap:wrap}
.legend li{display:flex;align-items:center}
.groups{display:grid;gap:12px}
.grow{display:grid;grid-template-columns:minmax(170px,1.1fr) 2fr minmax(210px,1.3fr);gap:16px;align-items:center}
.gname{font-weight:600}.gdesc{color:var(--text-muted);font-size:.8rem}
.seg{display:flex;gap:2px;height:24px}
.seg.empty{color:var(--text-muted);font-size:.85rem;align-items:center}
.part{border-radius:4px;color:#0b0b0b;font-size:.78rem;font-weight:650;display:flex;align-items:center;padding:0 8px;white-space:nowrap;min-width:3px;outline-offset:2px;cursor:default}
.part.s-failed{color:#fff}
.part:hover,.part:focus-visible{filter:brightness(1.12)}
.gcounts{display:flex;flex-wrap:wrap;gap:2px 12px;font-size:.85rem;color:var(--ink-2);align-items:center}
.grate{font-weight:650;color:var(--ink);min-width:3.2em}
.cnt{display:inline-flex;align-items:center;white-space:nowrap}
.chart svg{width:100%;height:auto;display:block}
.grid{stroke:var(--grid);stroke-width:1}.axis{stroke:var(--axis);stroke-width:1}
.tick{fill:var(--text-muted);font-size:11px;font-variant-numeric:tabular-nums}
.line{fill:none;stroke:var(--series-1);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
.dot{fill:var(--series-1);stroke:var(--surface-1);stroke-width:2}
.cross{stroke:var(--axis);stroke-width:1}
.endlabel{fill:var(--ink);font-size:12px;font-weight:600}
.tableview{margin-top:12px}
summary{cursor:pointer;color:var(--ink-2);font-size:.88rem}
.h2like{color:var(--ink)}
table{width:100%;border-collapse:collapse;margin-top:10px;font-size:.86rem}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--grid);vertical-align:top}
thead th{color:var(--text-muted);font-weight:600}
.num{text-align:right;font-variant-numeric:tabular-nums}
.tlist{list-style:none;padding:0;margin:0;display:grid;gap:10px}
.tcard{border:1px solid var(--border);border-radius:10px;padding:12px 14px}
.tchead{display:flex;gap:10px;align-items:center;margin-bottom:4px}
.badge{font-size:.75rem;font-weight:700;color:#fff;border-radius:999px;padding:2px 9px}.badge.s-flaky{color:#0b0b0b}
.area{color:var(--ink-2);font-size:.85rem}
.tname{font-weight:600}
.terr{font-family:ui-monospace,Consolas,monospace;font-size:.8rem;color:var(--ink-2);margin-top:6px;word-break:break-word}
.tmeta{color:var(--text-muted);font-size:.78rem;margin-top:6px}
.none{margin:0;font-weight:600;color:var(--good-text)}
.reasons{margin:0;padding:0;list-style:none;display:grid;gap:6px}.rcount{display:inline-block;min-width:2.2em;font-weight:650}
#tip{position:fixed;pointer-events:none;background:var(--surface-1);color:var(--ink);border:1px solid var(--border);box-shadow:0 6px 24px rgba(0,0,0,.18);border-radius:8px;padding:8px 10px;font-size:.82rem;max-width:280px;z-index:10}
#tip .v{font-weight:700;font-size:.95rem}#tip .l{color:var(--ink-2)}
footer{color:var(--text-muted);font-size:.8rem;margin-top:24px}
@media (max-width:820px){.kpis{grid-template-columns:1fr}.tiles{grid-template-columns:repeat(2,1fr)}.grow{grid-template-columns:1fr}}
@media print{.viz-root{color-scheme:light;--page:#fff;--surface-1:#fff;--ink:#0b0b0b;--ink-2:#52514e;--grid:#e1e0d9;--axis:#c3c2b7;--series-1:#2a78d6;--text-muted:#6b6a66;--link:#1c5cab;--good-text:#006300;--crit-text:#b3261e}
.btn,#tip{display:none!important}.card,.tile{break-inside:avoid}.wrap{padding:0}}
@media (forced-colors:active){.part,.key,.badge,.sicon{forced-color-adjust:none;border:1px solid CanvasText}}
`;

const SCRIPT = `
(function(){
var root=document.documentElement,btn=document.getElementById('theme');
try{var saved=localStorage.getItem('qa-report-theme');if(saved)root.setAttribute('data-theme',saved);}catch(e){}
function current(){return root.getAttribute('data-theme')||(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');}
function label(){btn.textContent=current()==='dark'?'Light theme':'Dark theme';}
if(btn){label();btn.addEventListener('click',function(){var t=current()==='dark'?'light':'dark';root.setAttribute('data-theme',t);try{localStorage.setItem('qa-report-theme',t);}catch(e){}label();});}
document.querySelectorAll('time[datetime]').forEach(function(t){var d=new Date(t.getAttribute('datetime'));if(!isNaN(d))t.textContent=d.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});});
var tip=document.createElement('div');tip.id='tip';tip.hidden=true;tip.setAttribute('role','tooltip');document.body.appendChild(tip);
function show(lines,x,y){tip.replaceChildren();lines.forEach(function(s,i){var d=document.createElement('div');d.className=i?'l':'v';d.textContent=s;tip.appendChild(d);});tip.hidden=false;
var w=tip.offsetWidth,h=tip.offsetHeight;tip.style.left=Math.min(innerWidth-w-8,Math.max(8,x-w/2))+'px';tip.style.top=(y-h-10<8?y+18:y-h-10)+'px';}
function hide(){tip.hidden=true;}
document.querySelectorAll('[data-tip]').forEach(function(el){
function at(){var r=el.getBoundingClientRect();show(el.getAttribute('data-tip').split('\\n'),r.left+r.width/2,r.top);}
el.addEventListener('pointerenter',at);el.addEventListener('focus',at);el.addEventListener('pointerleave',hide);el.addEventListener('blur',hide);});
var svg=document.getElementById('trend'),dataEl=document.getElementById('trend-data');
if(svg&&dataEl){var data=JSON.parse(dataEl.textContent),hit=document.getElementById('trendhit'),cross=document.getElementById('cross'),dot=document.getElementById('hoverdot'),idx=data.length-1;
function fmt(iso){var d=new Date(iso);return isNaN(d)?iso:d.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});}
function pick(i){idx=Math.max(0,Math.min(data.length-1,i));var p=data[idx];cross.setAttribute('x1',p.x);cross.setAttribute('x2',p.x);cross.setAttribute('visibility','visible');
dot.setAttribute('cx',p.x);dot.setAttribute('cy',p.y);dot.setAttribute('visibility','visible');
var m=svg.getScreenCTM(),pt=svg.createSVGPoint();pt.x=p.x;pt.y=p.y;var s=pt.matrixTransform(m);
show([p.v+' pass rate',fmt(p.when),p.fail+' failed of '+p.total+' tests'].concat(p.ref?[p.ref]:[]),s.x,s.y);
hit.setAttribute('aria-valuenow',idx+1);hit.setAttribute('aria-valuetext','Run '+(idx+1)+' of '+data.length+', '+fmt(p.when)+': '+p.v+' pass rate, '+p.fail+' failed');}
function off(){cross.setAttribute('visibility','hidden');dot.setAttribute('visibility','hidden');hide();}
hit.addEventListener('pointermove',function(e){var m=svg.getScreenCTM().inverse(),pt=svg.createSVGPoint();pt.x=e.clientX;pt.y=e.clientY;var x=pt.matrixTransform(m).x,best=0;
data.forEach(function(p,i){if(Math.abs(p.x-x)<Math.abs(data[best].x-x))best=i;});pick(best);});
hit.addEventListener('pointerleave',off);hit.addEventListener('focus',function(){pick(idx);});hit.addEventListener('blur',off);
hit.addEventListener('keydown',function(e){if(e.key==='ArrowLeft'){pick(idx-1);e.preventDefault();}if(e.key==='ArrowRight'){pick(idx+1);e.preventDefault();}});}
})();`;

export function renderHtml(m: RunModel, history: HistoryEntry[]): string {
  const prev = history.length >= 2 ? history[history.length - 2] : undefined;
  const st = RELEASE[m.status];
  const ref = [m.info.branch, m.info.commit].filter(Boolean).join(' @ ');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(m.title)} · ${esc(st.label)} · ${pct(m.passRate)}</title>
<style>${CSS}</style></head>
<body class="viz-root"><div class="wrap">
<header class="top"><div><h1>${esc(m.title)}</h1>
<div class="meta"><span><time datetime="${esc(m.startedAt)}">${esc(utc(m.startedAt))}</time></span>
<span>Environment <b>${esc(m.info.environment)}</b></span>${ref ? `<span>Build <b>${esc(ref)}</b></span>` : ''}
<span>Ran on <b>${esc(m.info.runner)}</b></span>${m.info.ciUrl ? `<span><a href="${esc(m.info.ciUrl)}">CI run</a></span>` : ''}</div></div>
<button class="btn" id="theme" type="button">Dark theme</button></header>

<section class="card status ${st.cls}" aria-label="Release status">
<div class="sicon" aria-hidden="true">${st.icon}</div>
<div><div class="slabel">${esc(st.label)}</div><div class="sreason">${esc(m.statusReason)}</div></div></section>

${kpis(m, prev)}
${groupSection('areas', 'Results by area', 'Each product area under test. Bars show the share of tests by result.', m.areas)}
${groupSection(
  'dimensions',
  'Results by quality dimension',
  'What kind of risk the tests cover. A test can count in more than one dimension.',
  m.dimensions,
)}
${trend(history)}
${issues(m)}
${allTests(m)}
<footer>Generated by the unified automation framework (Playwright ${esc(m.info.playwright)}, ${m.info.workers} workers).
Release status rules: <b>Not ready</b> if any critical-journey or security test fails or the pass rate is below 90%;
<b>At risk</b> if anything else fails or is flaky; otherwise <b>Ready to release</b>.${
    m.detailReport ? ` Engineers: <a href="${esc(m.detailReport)}">detailed report</a>.` : ''
  }</footer>
</div><script>${SCRIPT}</script></body></html>`;
}

/** Short Markdown version for CI job summaries, chat and email. */
export function renderMarkdown(m: RunModel): string {
  const st = RELEASE[m.status];
  const c = m.counts;
  const lines = [
    `## ${st.icon} ${st.label}: ${pct(m.passRate)} pass rate`,
    '',
    m.statusReason,
    '',
    `| Tests | ✓ Passed | ✕ Failed | ! Flaky | – Skipped | Duration |`,
    `| ---: | ---: | ---: | ---: | ---: | ---: |`,
    `| ${c.total} | ${c.passed} | ${c.failed} | ${c.flaky} | ${c.skipped} | ${fmtDuration(m.durationMs)} |`,
    '',
    `| Area | Tests | Failed | Pass rate |`,
    `| --- | ---: | ---: | ---: |`,
    ...m.areas.map(
      (a) => `| ${a.label} | ${a.counts.total} | ${a.counts.failed} | ${pct(passRateOf(a.counts))} |`,
    ),
  ];
  if (m.failures.length)
    lines.push(
      '',
      '### Failures',
      ...m.failures.map(
        (f) => `- **${f.area}**: ${f.path || f.title}${f.error ? ` (${f.error.slice(0, 160)})` : ''}`,
      ),
    );
  return `${lines.join('\n')}\n`;
}
