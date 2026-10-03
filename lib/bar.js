// What the bar shows, as plain data: the model built from the trail and Claude
// Code's usage numbers, and the labelled chips drawn from it. No mods API calls,
// so the Node tests and the preview script use it too.
import { sanitize } from './rules.js';

const VS15 = String.fromCodePoint(0xfe0e); // keeps the warning sign a text glyph, not an emoji

export const STRINGS = {
  en: {
    // What the status chip says: the most pressing reason, in plain words
    status: {
      ok: () => 'All clear',
      limitReached: (w) => `${w} limit reached`,
      riskHigh: () => 'High-risk action',
      limitSoon: (w) => `${w} limit approaching`,
      ctxFull: () => 'Context almost full',
      ctxHigh: () => 'Context filling up',
      risk: () => 'Risky action seen',
    },
    cmds: 'Commands', files: 'Files', net: 'Internet',
    risky: (n) => `${n} risky`,
    five_hour: '5-hour', seven_day: 'Weekly',
    pct: (n) => `${n}%`,
    fullIn: (d) => `full in ${d} at this pace`,
    reached: 'limit reached',
    resetsIn: (d) => `resets in ${d}`,
    ctx: 'Context', ctxFull: 'full',
    cost: 'API cost',
    dur: { lt1m: '<1m', m: (m) => `${m}m`, hm: (h, m) => (m ? `${h}h ${m}m` : `${h}h`), dh: (d, h) => (h ? `${d}d ${h}h` : `${d}d`) },
    read: (f) => `read ${f}`, edited: (f) => `edited ${f}`, secret: 'secret in command',
    legend: [
      'what the agent did this session, and your limits',
      '● Status: green when all is clear; amber or red with the reason, such as "Context filling up" or "5-hour limit approaching"',
      'Commands · Files · Internet: shell commands run, files created or edited, calls that left your machine',
      '⚠ risky: actions worth a second look, such as git push --force or reading .env, and the latest one',
      '5-hour · Weekly: how much of your plan limit is used and when it resets; "full in … at this pace" appears only if you would hit it first',
      'Context: how full the conversation\'s context window is',
      'API cost: what this session would cost at API list prices, as Claude Code estimates it; on a Pro or Max plan you are not billed this',
      'Language: /korkmaz-trail en · /korkmaz-trail tr',
    ],
    langSet: 'Language: English',
  },
  tr: {
    status: {
      ok: () => 'Her şey yolunda',
      limitReached: (w) => `${w} limit doldu`,
      riskHigh: () => 'Yüksek riskli işlem',
      limitSoon: (w) => `${w} limit yaklaşıyor`,
      ctxFull: () => 'Bağlam neredeyse dolu',
      ctxHigh: () => 'Bağlam doluyor',
      risk: () => 'Riskli işlem var',
    },
    cmds: 'Komut', files: 'Dosya', net: 'İnternet',
    risky: (n) => `${n} riskli`,
    five_hour: '5 saatlik', seven_day: 'Haftalık',
    pct: (n) => `%${n}`,
    fullIn: (d) => `bu hızla ${d} içinde dolar`,
    reached: 'limit doldu',
    resetsIn: (d) => `sıfırlanmaya ${d}`,
    ctx: 'Bağlam', ctxFull: 'dolu',
    cost: 'API maliyeti',
    dur: { lt1m: '<1 dk', m: (m) => `${m} dk`, hm: (h, m) => (m ? `${h} sa ${m} dk` : `${h} sa`), dh: (d, h) => (h ? `${d} g ${h} sa` : `${d} g`) },
    read: (f) => `${f} okundu`, edited: (f) => `${f} düzenlendi`, secret: 'komutta gizli anahtar',
    legend: [
      'bu oturumda ajanın yaptıkları ve limitlerin',
      '● Durum: her şey yolundaysa yeşil; değilse turuncu ya da kırmızı ve sebebiyle, ör. "Bağlam doluyor", "5 saatlik limit yaklaşıyor"',
      'Komut · Dosya · İnternet: çalıştırılan komutlar, oluşturulan ya da değiştirilen dosyalar, bilgisayarından dışarı çıkan çağrılar',
      '⚠ riskli: dikkat isteyen işlemler (ör. git push --force, .env okuma) ve sonuncusu',
      '5 saatlik · Haftalık: plan limitinin ne kadarının kullanıldığı ve ne zaman sıfırlanacağı; "bu hızla … içinde dolar" yalnızca sıfırlanmadan önce dolacaksan çıkar',
      'Bağlam: konuşmanın bağlam penceresinin ne kadar dolu olduğu',
      'API maliyeti: bu oturumun API liste fiyatıyla tutarı (Claude Code\'un tahmini); Pro veya Max planında bu tutar senden çekilmez',
      'Dil: /korkmaz-trail en · /korkmaz-trail tr',
    ],
    langSet: 'Dil: Türkçe',
  },
};

export const GLYPHS = {
  unicode: { dot: '●', warn: `⚠${VS15}`, on: '▰', off: '▱', sep: '│' },
  ascii: { dot: '*', warn: '!', on: '=', off: '-', sep: '|' },
};

const RANK = { ok: 0, watch: 1, act: 2 };

export function fmtDuration(seconds, L = STRINGS.en) {
  const m = Math.floor(Math.max(0, seconds) / 60);
  if (m < 1) return L.dur.lt1m;
  const d = Math.floor(m / 1440);
  const h = Math.floor((m % 1440) / 60);
  if (d) return L.dur.dh(d, h);
  if (h) return L.dur.hm(h, m % 60);
  return L.dur.m(m);
}

/** The bar's language for a locale such as tr-TR: Turkish on a Turkish system, English otherwise. */
export function systemLanguage(locale = Intl.DateTimeFormat().resolvedOptions().locale) {
  const code = String(locale || '').toLowerCase().split(/[-_]/)[0];
  return STRINGS[code] ? code : 'en';
}

export const legend = (lang = 'en') => {
  const L = STRINGS[lang] || STRINGS.en;
  return L.legend.join('\n');
};

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
    // A high-severity action turns the status red for 15 minutes, then amber.
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

  // The status chip names the most pressing reason; among equal severities, the lower rank wins.
  const causes = [];
  for (const w of windows) {
    if (w.pct >= 100) causes.push({ sev: 'act', rank: 0, key: 'limitReached', win: w.key });
    else if (w.sev !== 'ok') causes.push({ sev: w.sev, rank: 2, key: 'limitSoon', win: w.key });
  }
  if (audit?.sev === 'act') causes.push({ sev: 'act', rank: 1, key: 'riskHigh' });
  else if (audit?.sev === 'watch') causes.push({ sev: 'watch', rank: 5, key: 'risk' });
  if (ctx?.sev === 'act') causes.push({ sev: 'act', rank: 3, key: 'ctxFull' });
  else if (ctx?.sev === 'watch') causes.push({ sev: 'watch', rank: 4, key: 'ctxHigh' });
  causes.sort((a, b) => RANK[b.sev] - RANK[a.sev] || a.rank - b.rank);
  const reason = causes[0] || { sev: 'ok', key: 'ok' };
  return { audit, windows, ctx, cost, sev: reason.sev, reason };
}

// ------------------------------------------------------------------- chips --

function riskText(risk, L) {
  if (!risk) return '';
  if (risk.kind === 'secret') return L.secret;
  if (risk.kind === 'read') return L.read(risk.arg);
  if (risk.kind === 'edited') return L.edited(risk.arg);
  return risk.arg;
}

const part = (text, tone = null, bold = false) => ({ text, tone, bold });

/**
 * The bar as labelled chips: `{ key, tint, parts: [{ text, tone, bold }] }`.
 * `tint` and `tone` are ok, watch, act, dim or null. Level 0 says everything;
 * level 1 drops the weekly reset time and the cost, level 2 the gauges too,
 * and level 3 keeps only the numbers. The gauges go last because they read fastest.
 */
export function chips(m, lang = 'en', level = 0, ascii = false) {
  const L = STRINGS[lang] || STRINGS.en;
  const G = ascii ? GLYPHS.ascii : GLYPHS.unicode;
  const out = [];
  const chip = (key, tint, parts) => out.push({ key, tint, parts: parts.filter((p) => p.text) });
  const alarm = (sev) => (sev === 'ok' ? null : sev);

  const reason = m.reason || { key: 'ok' };
  const said = L.status[reason.key](reason.win ? L[reason.win] : '');
  chip('status', m.sev, level >= 3 ? [part(G.dot, m.sev)] : [part(G.dot, m.sev), part(` ${said}`, alarm(m.sev), m.sev !== 'ok')]);

  if (m.audit) {
    const a = m.audit;
    const count = (label, n) => (level >= 3 ? [part(`${label[0]} `, 'dim'), part(String(n), null, true)] : [part(`${label} `, 'dim'), part(String(n), null, true)]);
    chip('trail', null, [...count(L.cmds, a.cmds), part(' · ', 'dim'), ...count(L.files, a.files), part(' · ', 'dim'), ...count(L.net, a.net)]);
    if (a.riskCount) {
      const tone = a.sev === 'ok' ? 'watch' : a.sev;
      const what = level < 3 && a.top ? `: ${sanitize(riskText(a.top, L), level === 0 ? 34 : 20)}` : '';
      chip('risk', tone, [part(`${G.warn} ${L.risky(a.riskCount)}`, tone, true), part(what, tone)]);
    }
  }

  for (const w of m.windows) {
    if (level >= 3 && w.key !== 'five_hour') continue;
    const parts = [part(`${L[w.key]} `, 'dim'), part(L.pct(Math.round(w.pct)), alarm(w.sev), true)];
    if (level <= 1) {
      const n = Math.max(0, Math.min(6, Math.round((w.pct / 100) * 6)));
      parts.push(part(' '), part(G.on.repeat(n), w.sev), part(G.off.repeat(6 - n), 'dim'));
    }
    if (w.pct >= 100) parts.push(part(` · ${L.reached}`, 'act', true));
    else if (w.eta !== null && w.eta < w.timeLeft) parts.push(part(` · ${L.fullIn(fmtDuration(w.eta, L))}`, w.sev));
    if (level === 0 || (level <= 2 && w.key === 'five_hour')) parts.push(part(` · ${L.resetsIn(fmtDuration(w.timeLeft, L))}`, 'dim'));
    chip(w.key, alarm(w.sev), parts);
  }

  if (m.ctx) chip('ctx', alarm(m.ctx.sev), [part(`${L.ctx} `, 'dim'), part(L.pct(m.ctx.pct), alarm(m.ctx.sev), true), part(level < 3 ? ` ${L.ctxFull}` : '', 'dim')]);
  if (m.cost !== null && level === 0) chip('cost', null, [part(`${L.cost} `, 'dim'), part(`$${m.cost.toFixed(2)}`, null, true)]);
  return out;
}

/** Chips as one line of text, for the terminal. */
export function chipLine(list, ascii = false) {
  const G = ascii ? GLYPHS.ascii : GLYPHS.unicode;
  const segs = [];
  list.forEach((c, i) => {
    if (i) segs.push(part(` ${G.sep} `, 'dim'));
    segs.push(...c.parts);
  });
  return segs;
}

export const widthOf = (segs) => segs.reduce((n, s) => n + Array.from(s.text).filter((ch) => ch !== VS15).length, 0);

/**
 * The most detailed chips that fit `columns` across `rows` rows (0 columns = no
 * limit). Each chip costs two extra columns for its padding.
 */
export function fit(model, columns = 0, lang = 'en', rows = 1, ascii = false) {
  for (let level = 0; level <= 3; level += 1) {
    const list = chips(model, lang, level, ascii);
    const width = widthOf(chipLine(list, ascii)) + list.length * 2;
    if (!columns || width <= (columns - 2) * rows || level === 3) return list;
  }
  return [];
}

/** Join neighbouring parts that share a style, so the drawing needs fewer elements. */
export function merge(parts) {
  const out = [];
  for (const s of parts) {
    const last = out[out.length - 1];
    if (last && last.tone === s.tone && last.bold === s.bold) last.text += s.text;
    else out.push({ ...s });
  }
  return out;
}

export const plainText = (segs) => segs.map((s) => s.text).join('');
