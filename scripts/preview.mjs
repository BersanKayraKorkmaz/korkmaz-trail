#!/usr/bin/env node
// Writes assets/preview.html (or preview-tr.html with --lang=tr): three sample
// states of the bar as the Desktop app draws them, from lib/bar.js. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildModel, chips, merge } from '../lib/bar.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const lang = process.argv.includes('--lang=tr') ? 'tr' : 'en';
const escape = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// Stand-ins for the success, warning, error and dim theme colours, and the mod's chip tints
const TONES = { ok: '#1f8a54', watch: '#c25a12', act: '#d23a33', dim: '#6f747b' };
const TINTS = { ok: 'rgba(47,163,107,0.16)', watch: 'rgba(217,106,28,0.18)', act: 'rgba(224,68,62,0.18)', neutral: 'rgba(127,127,127,0.13)' };

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
    trail: { cmds: 42, files: 7, net: 3, riskCount: 0, risks: [] },
    usage: usage([23, 9600], [41, 274000], 38, 4.32),
  },
  {
    trail: { cmds: 118, files: 21, net: 9, riskCount: 2, risks: [{ t: now - 3600, sev: 'medium', kind: 'read', arg: '.env' }, { t: now - 900, sev: 'medium', kind: 'cmd', arg: 'git reset --hard HEAD~1' }] },
    usage: usage([76, 9600], [58, 112000], 81, 12.8),
    samples: { five_hour: [[now - 1800, 61], [now, 76]] },
  },
  {
    trail: { cmds: 203, files: 34, net: 17, riskCount: 3, risks: [{ t: now - 5400, sev: 'medium', kind: 'read', arg: '.env' }, { t: now - 120, sev: 'high', kind: 'cmd', arg: 'git push --force origin main' }] },
    usage: usage([100, 4320], [88, 52000], 93, 27.45),
  },
];

const span = (p) => `<span style="${p.tone ? `color:${TONES[p.tone]};` : ''}${p.bold ? 'font-weight:650;' : ''}">${escape(p.text)}</span>`;
const bands = scenes
  .map((s) => {
    const list = chips(buildModel({ trail: s.trail, usage: s.usage, samples: s.samples, now }), lang);
    const html = list.map((c) => `<span class="chip" style="background:${TINTS[c.tint || 'neutral']}">${merge(c.parts).map(span).join('')}</span>`).join('');
    return `<div class="band">${html}</div>`;
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
  :root { --bg: #faf9f6; --band: #efeeea; --ink: #1d1f22; --muted: #6f747b; --amber: #e8792b; }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.5 "Segoe UI", system-ui, -apple-system, sans-serif; }
  .card { width: 1180px; padding: 28px 32px 30px; }
  .brand { display: flex; align-items: baseline; gap: 14px; margin-bottom: 20px; }
  .brand b { font-size: 26px; letter-spacing: -0.02em; font-weight: 650; }
  .brand b i { display: inline-block; width: 0.4em; height: 0.4em; margin-right: 0.32em; background: var(--amber); vertical-align: 0.12em; }
  .brand span { color: var(--muted); font-size: 15px; }
  .band { display: flex; flex-wrap: wrap; gap: 8px; padding: 10px 12px; margin-top: 12px; background: var(--band); border-radius: 12px; }
  .chip { padding: 3px 10px; border-radius: 999px; white-space: pre; }
</style>
</head>
<body>
<div class="card">
  <div class="brand"><b><i></i>korkmaz-trail</b><span>${tagline}</span></div>
${bands}
</div>
</body>
</html>
`;

const out = path.join(root, 'assets', lang === 'tr' ? 'preview-tr.html' : 'preview.html');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(out);
