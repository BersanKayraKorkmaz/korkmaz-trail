import test from 'node:test';
import assert from 'node:assert/strict';
import { STRINGS, WINDOWS, buildModel, chipLine, chips, fit, fmtDuration, forecast, legend, merge, plainText, pushSample, systemLanguage, widthOf } from '../lib/bar.js';

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
const texts = (model, lang = 'en', level = 0) => chips(model, lang, level).map((c) => plainText(c.parts));

test('the system locale picks the language', () => {
  assert.equal(systemLanguage('tr-TR'), 'tr');
  assert.equal(systemLanguage('TR_tr'), 'tr');
  assert.equal(systemLanguage('en-US'), 'en');
  assert.equal(systemLanguage('de-DE'), 'en');
  assert.equal(systemLanguage(''), 'en');
});

test('durations read naturally in both languages', () => {
  assert.equal(fmtDuration(9600), '2h 40m');
  assert.equal(fmtDuration(3 * 86400 + 4 * 3600 + 59), '3d 4h');
  assert.equal(fmtDuration(3 * 3600), '3h');
  assert.equal(fmtDuration(45 * 60), '45m');
  assert.equal(fmtDuration(20), '<1m');
  assert.equal(fmtDuration(3900, STRINGS.tr), '1 sa 5 dk');
  assert.equal(fmtDuration(86400 + 7 * 3600, STRINGS.tr), '1 g 7 sa');
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

test('every fact gets its own labelled chip', () => {
  const m = buildModel({ trail: trail(), usage: usage([23, 9600], [41, 274000]), now: NOW });
  assert.deepEqual(texts(m), [
    '● All clear',
    'Commands 42 · Files 7 · Internet 3',
    '5-hour 23% ▰▱▱▱▱▱ · resets in 2h 40m',
    'Weekly 41% ▰▰▱▱▱▱ · resets in 3d 4h',
    'Context 38% full',
    'API cost $4.32',
  ]);
  assert.deepEqual(texts(m, 'tr'), [
    '● Her şey yolunda',
    'Komut 42 · Dosya 7 · İnternet 3',
    '5 saatlik %23 ▰▱▱▱▱▱ · sıfırlanmaya 2 sa 40 dk',
    'Haftalık %41 ▰▰▱▱▱▱ · sıfırlanmaya 3 g 4 sa',
    'Bağlam %38 dolu',
    'API maliyeti $4.32',
  ]);
  assert.deepEqual(chips(m).map((c) => c.tint), ['ok', null, null, null, null, null]);
});

test('a pace that hits the limit before the reset warns, with the latest risk', () => {
  const risks = [
    { t: NOW - 7200, sev: 'medium', kind: 'read', arg: '.env' },
    { t: NOW - 60, sev: 'high', kind: 'cmd', arg: 'git push --force' },
  ];
  const samples = { five_hour: [[NOW - 1800, 60], [NOW, 76]] }; // 16% in 30 min
  const m = buildModel({ trail: trail({ riskCount: 2, risks }), usage: usage([76, 9600]), samples, now: NOW });
  assert.equal(m.sev, 'act'); // a high-risk action a minute ago
  assert.deepEqual(texts(m).slice(0, 4), [
    '● High-risk action',
    'Commands 42 · Files 7 · Internet 3',
    `${WARN} 2 risky: git push --force`,
    '5-hour 76% ▰▰▰▰▰▱ · full in 45m at this pace · resets in 2h 40m',
  ]);
  assert.deepEqual(texts(m, 'tr')[3], '5 saatlik %76 ▰▰▰▰▰▱ · bu hızla 45 dk içinde dolar · sıfırlanmaya 2 sa 40 dk');
  const later = buildModel({ trail: trail({ riskCount: 2, risks }), usage: usage([76, 9600]), now: NOW + 3600 });
  assert.equal(later.audit.sev, 'watch'); // red fades to amber after 15 minutes
});

test('a full window says so', () => {
  const m = buildModel({ usage: usage([100, 4320]), now: NOW });
  assert.equal(texts(m)[0], '● 5-hour limit reached');
  assert.equal(texts(m, 'tr')[0], '● 5 saatlik limit doldu');
  assert.equal(texts(m)[1], '5-hour 100% ▰▰▰▰▰▰ · limit reached · resets in 1h 12m');
  assert.equal(chips(m)[1].tint, 'act');
});

test('the status names the most pressing reason', () => {
  const status = (args, lang) => texts(buildModel({ now: NOW, ...args }), lang)[0];
  assert.equal(status({ usage: usage(null, null, 81) }), '● Context filling up');
  assert.equal(status({ usage: usage(null, null, 81) }, 'tr'), '● Bağlam doluyor');
  assert.equal(status({ usage: usage(null, null, 93) }), '● Context almost full');
  assert.equal(status({ usage: usage([92, 9600], null, 30) }, 'tr'), '● 5 saatlik limit yaklaşıyor');
  const risky = trail({ riskCount: 1, risks: [{ t: NOW - 7200, sev: 'medium', kind: 'cmd', arg: 'sudo ls' }] });
  assert.equal(status({ trail: risky, usage: usage(null, null, 30) }), '● Risky action seen');
  // A full limit outranks a recent high-risk action
  const hot = trail({ riskCount: 1, risks: [{ t: NOW - 60, sev: 'high', kind: 'cmd', arg: 'rm -rf ~' }] });
  assert.equal(status({ trail: hot, usage: usage([100, 600], null, 30) }), '● 5-hour limit reached');
});

test('risk labels are translated, secrets never shown', () => {
  const m = (risk) => buildModel({ trail: trail({ riskCount: 1, risks: [risk] }), now: NOW });
  assert.equal(texts(m({ t: 0, sev: 'medium', kind: 'read', arg: '.env' }), 'tr')[2], `${WARN} 1 riskli: .env okundu`);
  assert.equal(texts(m({ t: 0, sev: 'high', kind: 'secret', arg: '' }))[2], `${WARN} 1 risky: secret in command`);
});

test('narrow widths drop gauges, then reset times and cost, then words', () => {
  const m = buildModel({ trail: trail(), usage: usage([23, 9600], [41, 274000]), now: NOW });
  const wide = fit(m, 0);
  assert.equal(wide.length, 6);
  const mid = plainText(chipLine(fit(m, 120)));
  assert.ok(!mid.includes('▰'), mid);
  assert.ok(widthOf(chipLine(fit(m, 120))) + fit(m, 120).length * 2 <= 118, mid);
  assert.equal(plainText(chipLine(fit(m, 30))), '● │ C 42 · F 7 · I 3 │ 5-hour 23% │ Context 38%');
  assert.ok(fit(m, 120, 'en', 2).some((c) => c.parts.some((p) => p.text.includes('▰')))); // two rows fit the gauges
});

test('the gauges are the last detail to go', () => {
  const m = buildModel({ trail: trail(), usage: usage([23, 9600], [41, 274000]), now: NOW });
  const level1 = chips(m, 'tr', 1);
  const room = widthOf(chipLine(level1)) + level1.length * 2 + 2; // level 1 just fits, level 0 doesn't
  const text = plainText(chipLine(fit(m, room, 'tr')));
  assert.match(text, /▰/);
  assert.doesNotMatch(text, /API maliyeti/);
  assert.match(text, /Haftalık %41 ▰▰▱▱▱▱( │|$)/); // the weekly reset time went first
  assert.match(text, /sıfırlanmaya 2 sa 40 dk/); // the 5-hour one stays
});

test('no data yet: just the status; merge joins equal styles; legend explains', () => {
  assert.deepEqual(texts(buildModel({ now: NOW })), ['● All clear']);
  assert.deepEqual(merge([{ text: 'a', tone: null, bold: false }, { text: 'b', tone: null, bold: false }, { text: 'c', tone: 'dim', bold: false }]), [
    { text: 'ab', tone: null, bold: false },
    { text: 'c', tone: 'dim', bold: false },
  ]);
  assert.match(legend('tr'), /Komut · Dosya · İnternet/);
  assert.match(legend('en'), /\/korkmaz-trail tr/);
});
