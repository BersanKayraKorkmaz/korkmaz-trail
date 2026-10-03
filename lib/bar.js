// What the bar shows, as plain data: the model built from the trail and Claude
// Code's usage numbers, and the segments of text drawn from it. No imports and
// no mods API calls, so the Node tests and the preview script use it too.
import { sanitize } from './rules.js';

const VS15 = String.fromCodePoint(0xfe0e); // keeps the warning sign a text glyph, not an emoji

export const STRINGS = {
  en: {
    five_hour: '5h', seven_day: '7d', ctx: 'ctx',
    limitIn: (d) => `limit in ${d}`, pct: (n) => `${n}%`,
    d: 'd', h: 'h', m: 'm', gap: '', lt1m: '<1m',
    read: (f) => `read ${f}`, edited: (f) => `edited ${f}`, secret: 'secret in command',
  },
  tr: {
    five_hour: '5sa', seven_day: '7g', ctx: 'bağlam',
    limitIn: (d) => `limite ${d}`, pct: (n) => `%${n}`,
    d: 'g', h: 'sa', m: 'dk', gap: ' ', lt1m: '<1dk',
    read: (f) => `${f} okundu`, edited: (f) => `${f} düzenlendi`, secret: 'komutta gizli anahtar',
  },
};

export const GLYPHS = {
  unicode: { lead: '■', cmd: '❯', edit: '✎', net: '⇅', warn: `⚠${VS15}`, reset: '↻', arrow: '→', on: '▰', off: '▱', bar: '│', dot: '·' },
  ascii: { lead: '#', cmd: '>', edit: '*', net: '~', warn: '!', reset: '@', arrow: '->', on: '=', off: '-', bar: '|', dot: '-' },
};

const RANK = { ok: 0, watch: 1, act: 2 };
const worst = (...levels) => levels.reduce((a, b) => (RANK[b] > RANK[a] ? b : a), 'ok');

export function fmtDuration(seconds, L = STRINGS.en) {
  const m = Math.floor(Math.max(0, seconds) / 60);
  if (m < 1) return L.lt1m;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  const mm = m % 60;
  if (d) return `${d}${L.d}${L.gap}${h}${L.h}`;
  if (h) return `${h}${L.h}${L.gap}${String(mm).padStart(2, '0')}${L.m}`;
  return `${mm}${L.m}`;
}

// ------------------------------------------------------------------ limits --

export const WINDOWS = {
  five_hour: { span: 5 * 3600, lookback: 30 * 60, minSpan: 5 * 60, minElapsed: 15 * 60, urgent: 30 * 60 },
  seven_day: { span: 7 * 86400, lookback: 6 * 3600, minSpan: 3600, minElapsed: 12 * 3600, urgent: 6 * 3600 },
};

/** Project usage at the reset from the recent burn rate, or the window's average. Seconds throughout. */
export function forecast(pct, resetsAt, now, samples, spec) {
  const timeLeft = Math.max(0, resetsAt - now);
  const elapsed = spec.span - timeLeft;
  let rate = null;
  const recent = samples.filter(([t]) => now - t <= spec.lookback);
  if (recent.length >= 2) {
    const [t0, p0] = recent[0];
    const [t1, p1] = recent[recent.length - 1];
    if (t1 - t0 >= spec.minSpan) rate = Math.max(0, (p1 - p0) / (t1 - t0));
  }
  if (rate === null && elapsed >= spec.minElapsed) rate = Math.max(0, pct / elapsed);
  if (rate === null) return { timeLeft, projected: null, eta: null };
  const projected = pct + rate * timeLeft;
  const eta = projected >= 100 && rate > 0 ? Math.max(0, (100 - pct) / rate) : null;
  return { timeLeft, projected, eta };
}

/** Add a reading to a window's samples; a drop in usage means the window reset. */
export function pushSample(samples, now, pct, spec) {
  const last = samples[samples.length - 1];
  let list = last && pct < last[1] - 0.5 ? [] : samples.slice();
  const prev = list[list.length - 1];
  if (!prev || pct !== prev[1] || now - prev[0] >= 60) list.push([now, pct]);
  list = list.filter(([t]) => now - t <= spec.lookback * 2);
  return list.slice(-300);
}

// ------------------------------------------------------------------- model --

function windowSev(w, spec) {
  if (w.pct >= 100) return 'act';
  if (w.eta !== null && w.eta < w.timeLeft) return w.eta <= spec.urgent ? 'act' : 'watch';
  return w.pct >= 90 ? 'watch' : 'ok';
}

/**
 * trail:   { cmds, files, net, riskCount, risks: [{ t, sev, kind, arg }] }
 * usage:   what $.session.usage() returns: { context: { percent }, rateLimits: [{ kind, percentUsed, resetsAt }], cost: { usd } }
 * samples: { five_hour: [[t, pct]], seven_day: [...] }, t in seconds
 */
export function buildModel({ trail = null, usage = null, samples = {}, now }) {
  let audit = null;
  if (trail) {
    const risks = trail.risks || [];
    const recentHigh = [...risks].reverse().find((r) => r.sev === 'high');
    const top = recentHigh || risks[risks.length - 1] || null;
    let sev = 'ok';
    // A high-severity action turns the square red for 15 minutes, then amber.
    if (trail.riskCount > 0) sev = recentHigh && recentHigh.t > 0 && now - recentHigh.t <= 15 * 60 ? 'act' : 'watch';
    audit = { cmds: trail.cmds, files: trail.files, net: trail.net, riskCount: trail.riskCount, top, sev };
  }

  const windows = [];
  for (const key of Object.keys(WINDOWS)) {
    const r = (usage?.rateLimits || []).find((x) => x?.kind === key);
    const pct = Number(r?.percentUsed);
    const resetsAt = Math.floor(Date.parse(r?.resetsAt) / 1000);
    if (!r || !Number.isFinite(pct) || !Number.isFinite(resetsAt)) continue;
    const w = { key, pct, ...forecast(pct, resetsAt, now, samples[key] || [], WINDOWS[key]) };
    windows.push({ ...w, sev: windowSev(w, WINDOWS[key]) });
  }

  const p = Number(usage?.context?.percent);
  const ctx = usage?.context?.percent != null && Number.isFinite(p) ? { pct: Math.round(p), sev: p >= 90 ? 'act' : p >= 75 ? 'watch' : 'ok' } : null;
  const usd = Number(usage?.cost?.usd);
  const cost = usage?.cost?.usd != null && Number.isFinite(usd) ? usd : null;
  return { audit, windows, ctx, cost, sev: worst(audit?.sev || 'ok', ...windows.map((w) => w.sev), ctx?.sev || 'ok') };
}

// ---------------------------------------------------------------- segments --

function riskText(risk, L) {
  if (!risk) return '';
  if (risk.kind === 'secret') return L.secret;
  if (risk.kind === 'read') return L.read(risk.arg);
  if (risk.kind === 'edited') return L.edited(risk.arg);
  return risk.arg;
}

/**
 * The bar as a list of `{ text, tone, bold }`. `tone` is ok, watch, act, dim or
 * null for the default colour. Level 0 is the full layout; 1 and 2 are narrower.
 */
export function segments(m, level = 0, lang = 'en', ascii = false) {
  const L = STRINGS[lang] || STRINGS.en;
  const G = ascii ? GLYPHS.ascii : GLYPHS.unicode;
  const gap = level === 0 ? '  ' : ' ';
  const out = [];
  const push = (text, tone = null, bold = false) => {
    if (text) out.push({ text, tone, bold });
  };

  push(G.lead, m.sev);
  if (m.audit) {
    const a = m.audit;
    push(' ');
    push(G.cmd, 'dim');
    push(` ${a.cmds}${gap}`);
    push(G.edit, 'dim');
    push(` ${a.files}${gap}`);
    push(G.net, 'dim');
    push(` ${a.net}`);
    if (a.riskCount) {
      const tone = a.sev === 'ok' ? 'watch' : a.sev;
      push(gap);
      push(`${G.warn} `, tone);
      push(String(a.riskCount), tone, true);
      if (level < 2 && a.top) {
        push(' ');
        push(G.dot, 'dim');
        push(` ${sanitize(riskText(a.top, L), level === 0 ? 30 : 18)}`, tone);
      }
    }
  }

  const items = [];
  for (const w of m.windows) {
    if (level === 2 && w.key !== 'five_hour') continue;
    const item = [];
    const add = (text, tone = null, bold = false) => item.push({ text, tone, bold });
    add(`${L[w.key]} `, 'dim');
    if (level === 0) {
      const n = Math.max(0, Math.min(6, Math.round((w.pct / 100) * 6)));
      if (n) add(G.on.repeat(n), w.sev);
      if (n < 6) add(G.off.repeat(6 - n), 'dim');
      add(' ');
    }
    add(L.pct(Math.round(w.pct)), w.sev === 'ok' ? null : w.sev, true);
    if (w.eta !== null && w.eta < w.timeLeft && w.pct < 100) add(` ${G.arrow} ${L.limitIn(fmtDuration(w.eta, L))}`, w.sev);
    if (level < 2) add(` ${G.reset}${fmtDuration(w.timeLeft, L)}`, 'dim');
    items.push(item);
  }
  if (m.ctx) items.push([{ text: `${L.ctx} `, tone: 'dim' }, { text: L.pct(m.ctx.pct), tone: m.ctx.sev === 'ok' ? null : m.ctx.sev }]);
  if (m.cost !== null && level < 2) items.push([{ text: `$${m.cost.toFixed(2)}`, tone: 'dim' }]);

  if (items.length) {
    push(level === 0 ? '  ' : ' ');
    push(G.bar, 'dim');
    push(level === 0 ? '  ' : ' ');
    items.forEach((item, i) => {
      if (i) push(gap);
      for (const s of item) push(s.text, s.tone, s.bold);
    });
  }
  return out;
}

export const widthOf = (segs) => segs.reduce((n, s) => n + Array.from(s.text).filter((ch) => ch !== VS15).length, 0);

/** The widest layout that fits `columns` (0 = no limit). */
export function layout(model, columns = 0, lang = 'en', ascii = false) {
  for (let level = 0; level <= 2; level += 1) {
    const segs = segments(model, level, lang, ascii);
    if (!columns || widthOf(segs) <= columns - 2 || level === 2) return segs;
  }
  return [];
}

/** Join neighbouring segments that share a style, so the drawing needs fewer elements. */
export function merge(segs) {
  const out = [];
  for (const s of segs) {
    const last = out[out.length - 1];
    if (last && last.tone === s.tone && last.bold === s.bold) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

export const plainText = (segs) => segs.map((s) => s.text).join('');
