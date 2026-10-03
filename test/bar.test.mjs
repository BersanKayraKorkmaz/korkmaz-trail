import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, WINDOWS, buildModel, fmtDuration, forecast, layout, merge, plainText, pushSample, segments, widthOf } from '../lib/bar.js';

const WARN = `⚠${String.fromCodePoint(0xfe0e)}`;
const NOW = 1_800_000_000; // seconds
const iso = (s) => new Date(s * 1000).toISOString();

const usage = (five, seven, ctx = 38, usd = 4.321) => ({
  context: { tokens: 76000, window: 200000, percent: ctx },
  rateLimits: [
    ...(five ? [{ kind: 'five_hour', percentUsed: five[0], resetsAt: iso(NOW + five[1]) }] : []),
    ...(seven ? [{ kind: 'seven_day', percentUsed: seven[0], resetsAt: iso(NOW + seven[1]) }] : []),
  ],
  cost: { usd },
});
const trail = (extra = {}) => ({ cmds: 42, files: 7, net: 3, riskCount: 0, risks: [], ...extra });
const line = (model, level = 0, lang = 'en') => plainText(segments(model, level, lang));

test('durations read naturally in both languages', () => {
  assert.equal(fmtDuration(9600), '2h40m');
  assert.equal(fmtDuration(3 * 86400 + 4 * 3600 + 59), '3d4h');
  assert.equal(fmtDuration(45 * 60), '45m');
  assert.equal(fmtDuration(20), '<1m');
  assert.equal(fmtDuration(3900, STRINGS.tr), '1sa 05dk');
  assert.equal(fmtDuration(86400 + 7 * 3600, STRINGS.tr), '1g 7sa');
});

test('forecast uses the recent burn rate, then the window average', () => {
  const spec = WINDOWS.five_hour;
  const f = forecast(60, NOW + 7200, NOW, [[NOW - 1800, 40], [NOW, 60]], spec);
  assert.equal(Math.round(f.projected), 140);
  assert.equal(Math.round(f.eta), 3600);
  const avg = forecast(30, NOW + 3 * 3600, NOW, [], spec); // 2h elapsed at 15%/h
  assert.equal(Math.round(avg.projected), 75);
  assert.equal(avg.eta, null);
  assert.equal(forecast(5, NOW + 5 * 3600 - 60, NOW, [], spec).projected, null); // too early to tell
});

test('samples reset when usage drops and age out', () => {
  const spec = WINDOWS.five_hour;
  let s = pushSample([], NOW, 10, spec);
  s = pushSample(s, NOW + 30, 10, spec); // same value, too soon: skipped
  s = pushSample(s, NOW + 90, 12, spec);
  assert.deepEqual(s, [[NOW, 10], [NOW + 90, 12]]);
  assert.deepEqual(pushSample(s, NOW + 120, 1, spec), [[NOW + 120, 1]]); // a new window
  assert.deepEqual(pushSample(s, NOW + 4000, 12, spec), [[NOW + 4000, 12]]);
});

test('the full line', () => {
  const m = buildModel({ trail: trail(), usage: usage([23, 9600], [41, 274000]), now: NOW });
  assert.equal(m.sev, 'ok');
  assert.equal(line(m), '■ ❯ 42  ✎ 7  ⇅ 3  │  5h ▰▱▱▱▱▱ 23% ↻2h40m  7d ▰▰▱▱▱▱ 41% ↻3d4h  ctx 38%  $4.32');
  assert.equal(line(m, 0, 'tr'), '■ ❯ 42  ✎ 7  ⇅ 3  │  5sa ▰▱▱▱▱▱ %23 ↻2sa 40dk  7g ▰▰▱▱▱▱ %41 ↻3g 4sa  bağlam %38  $4.32');
});

test('a pace that hits the limit before the reset warns, with the latest risk', () => {
  const risks = [
    { t: NOW - 7200, sev: 'medium', kind: 'read', arg: '.env' },
    { t: NOW - 60, sev: 'high', kind: 'cmd', arg: 'git push --force' },
  ];
  const samples = { five_hour: [[NOW - 1800, 60], [NOW, 76]] }; // 16% in 30 min
  const m = buildModel({ trail: trail({ riskCount: 2, risks }), usage: usage([76, 9600]), samples, now: NOW });
  assert.equal(m.sev, 'act'); // a high-risk action a minute ago
  assert.equal(line(m), `■ ❯ 42  ✎ 7  ⇅ 3  ${WARN} 2 · git push --force  │  5h ▰▰▰▰▰▱ 76% → limit in 45m ↻2h40m  ctx 38%  $4.32`);
  const later = buildModel({ trail: trail({ riskCount: 2, risks }), usage: usage([76, 9600]), now: NOW + 3600 });
  assert.equal(later.audit.sev, 'watch'); // red fades to amber after 15 minutes
});

test('risk labels are translated, secrets never shown', () => {
  const m = (risk) => buildModel({ trail: trail({ riskCount: 1, risks: [risk] }), now: NOW });
  assert.match(line(m({ t: 0, sev: 'medium', kind: 'read', arg: '.env' }), 0, 'tr'), /\.env okundu$/);
  assert.match(line(m({ t: 0, sev: 'high', kind: 'secret', arg: '' })), /secret in command$/);
});

test('narrow widths drop gauges, then detail', () => {
  const m = buildModel({ trail: trail(), usage: usage([23, 9600], [41, 274000]), now: NOW });
  const compact = layout(m, 70);
  assert.ok(widthOf(compact) <= 68, plainText(compact));
  assert.ok(!plainText(compact).includes('▰'));
  assert.equal(plainText(layout(m, 30)), '■ ❯ 42 ✎ 7 ⇅ 3 │ 5h 23% ctx 38%');
});

test('no data yet: just the square; merge joins equal styles', () => {
  assert.equal(line(buildModel({ now: NOW })), '■');
  assert.deepEqual(merge([{ text: 'a', tone: null, bold: false }, { text: 'b', tone: null, bold: false }, { text: 'c', tone: 'dim', bold: false }]), [
    { text: 'ab', tone: null, bold: false },
    { text: 'c', tone: 'dim', bold: false },
  ]);
});
