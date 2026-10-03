#!/usr/bin/env node
// Writes assets/preview.html (or preview-tr.html with --lang=tr): three sample
// states of the bar, drawn from lib/bar.js, ready to screenshot. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel, merge, segments } from '../lib/bar.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lang = process.argv.includes('--lang=tr') ? 'tr' : 'en';
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Stand-ins for the success, warning, error and dim theme colours
const TONES = { ok: '#2fa36b', watch: '#d96a1c', act: '#e0443e', dim: '#8b929a' };

const now = 1_800_000_000;
const iso = (s) => new Date(s * 1000).toISOString();
const usage = (five, seven, ctx, usd) => ({
  context: { percent: ctx },
  rateLimits: [
    { kind: 'five_hour', percentUsed: five[0], resetsAt: iso(now + five[1]) },
    { kind: 'seven_day', percentUsed: seven[0], resetsAt: iso(now + seven[1]) },
  ],
  cost: { usd },
});

const scenes = [
  {
    caption: { en: 'all clear', tr: 'her şey yolunda' },
    trail: { cmds: 42, files: 7, net: 3, riskCount: 0, risks: [] },
    usage: usage([23, 9600], [41, 274000], 38, 4.32),
  },
  {
    caption: { en: 'worth a look', tr: 'göz atmaya değer' },
    trail: { cmds: 118, files: 21, net: 9, riskCount: 2, risks: [{ t: now - 3600, sev: 'medium', kind: 'read', arg: '.env' }, { t: now - 900, sev: 'medium', kind: 'cmd', arg: 'git reset --hard HEAD~1' }] },
    usage: usage([76, 9600], [58, 112000], 81, 12.8),
    samples: { five_hour: [[now - 1800, 61], [now, 76]] },
  },
  {
    caption: { en: 'act now', tr: 'şimdi müdahale' },
    trail: { cmds: 203, files: 34, net: 17, riskCount: 3, risks: [{ t: now - 5400, sev: 'medium', kind: 'read', arg: '.env' }, { t: now - 120, sev: 'high', kind: 'cmd', arg: 'git push --force origin main' }] },
    usage: usage([100, 4320], [88, 52000], 93, 27.45),
  },
];

const rows = scenes
  .map((s) => {
    const segs = merge(segments(buildModel({ trail: s.trail, usage: s.usage, samples: s.samples, now }), 0, lang));
    const line = segs
      .map((x) => `<span style="${x.tone ? `color:${TONES[x.tone]};` : ''}${x.bold ? 'font-weight:700;' : ''}">${escape(x.text)}</span>`)
      .join('');
    return `<div class="row"><div class="cap">${escape(s.caption[lang])}</div><div class="line">${line}</div></div>`;
  })
  .join('\n');

const tagline = lang === 'tr' ? 'yapay zekâ ajanının denetim izi, Claude Code giriş kutusunun üstünde' : 'an audit trail for your AI agent, above the Claude Code prompt';
const page = `<!doctype html>
<html lang="${lang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>korkmaz-trail preview</title>
<style>
  :root { --bg: #0d0f12; --card: #15181d; --edge: #262a31; --ink: #e9e6df; --muted: #8b929a; --amber: #e8792b; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 15px/1.5 "Cascadia Mono", "JetBrains Mono", Consolas, ui-monospace, monospace; }
  .card { width: max-content; min-width: 100%; padding: 28px 32px 30px; }
  .brand { display: flex; align-items: baseline; gap: 14px; margin-bottom: 22px; font-family: "Segoe UI", system-ui, sans-serif; }
  .brand b { font-size: 26px; letter-spacing: -0.02em; font-weight: 650; }
  .brand b i { display: inline-block; width: 0.4em; height: 0.4em; margin-right: 0.32em; background: var(--amber); vertical-align: 0.12em; }
  .brand span { color: var(--muted); font-size: 15px; }
  .row { display: grid; grid-template-columns: 150px auto; align-items: center; gap: 18px; padding: 12px 18px; margin-top: 10px; background: var(--card); border: 1px solid var(--edge); border-radius: 10px; }
  .cap { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: 0.08em; }
  .line { white-space: pre; }
</style>
</head>
<body>
<div class="card">
  <div class="brand"><b><i></i>korkmaz-trail</b><span>${tagline}</span></div>
${rows}
</div>
</body>
</html>
`;

const out = path.join(root, 'assets', lang === 'tr' ? 'preview-tr.html' : 'preview.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(out);
