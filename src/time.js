// Portions derived from Jira StopWatch, Copyright 2025 Carsten Gehling, Dan Tulloh, Y. Meyer-Norwood, et al.
// Licensed under the Apache License, Version 2.0 (see LICENSE). Modified: ported to a browser extension (JavaScript).
// Port of JiraTimeHelpers.cs, extended with weeks, "h:mm" and relative (+15m / -15m) input.

const MIN = 60_000;

/** Milliseconds -> Jira duration string ("1d 2h 30m"), using the instance's working-day length. */
export function toJiraTime(ms, hoursPerDay = 8) {
  let minutes = Math.floor(Math.max(0, ms) / MIN);
  const perDay = Math.round(hoursPerDay * 60);
  const d = Math.floor(minutes / perDay);
  minutes -= d * perDay;
  const h = Math.floor(minutes / 60);
  const m = minutes - h * 60;
  const parts = [];
  if (d) parts.push(`${d}d`);
  if (h) parts.push(`${h}h`);
  if (m || !parts.length) parts.push(`${m}m`);
  return parts.join(' ');
}

/**
 * Jira duration string -> milliseconds, or null if invalid.
 * Accepts "1w 2d 3h 4m", "1.5h", "90m", "1:30" (h:mm), "90" (minutes), "0".
 */
export function parseJiraTime(text, hoursPerDay = 8, daysPerWeek = 5) {
  if (text == null) return null;
  const s = String(text).trim().toLowerCase().replace(/,/g, '.');
  if (!s) return null;
  let m;
  if ((m = s.match(/^(\d+):([0-5]?\d)$/))) return (+m[1] * 60 + +m[2]) * MIN;
  if (/^\d+(\.\d+)?$/.test(s)) return Math.round(parseFloat(s)) * MIN;
  const unit = { w: hoursPerDay * daysPerWeek * 60, d: hoursPerDay * 60, h: 60, m: 1 };
  const re = /(\d+(?:\.\d+)?)\s*([wdhm])/g;
  let total = 0, consumed = '';
  while ((m = re.exec(s))) { total += parseFloat(m[1]) * unit[m[2]]; consumed += m[0]; }
  if (!consumed || s.replace(/\s+/g, '') !== consumed.replace(/\s+/g, '')) return null;
  return Math.round(total) * MIN;
}

/** Parses "+15m" / "-1h" relative to `current`, or an absolute duration. */
export function parseTimeEdit(text, currentMs, hoursPerDay, daysPerWeek) {
  const s = String(text).trim();
  const sign = s[0] === '+' ? 1 : s[0] === '-' ? -1 : 0;
  const v = parseJiraTime(sign ? s.slice(1) : s, hoursPerDay, daysPerWeek);
  if (v == null) return null;
  return sign ? Math.max(0, currentMs + sign * v) : v;
}

/** Stopwatch display "1:02:03". */
export function clock(ms) {
  const t = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(t / 3600), m = Math.floor((t % 3600) / 60), sec = t % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

/** Round up to whole minutes, like WatchTimer.TimeElapsedNearestMinute. */
export function ceilMinute(ms) { return Math.ceil(ms / MIN) * MIN; }

/** Date -> Jira "started" format: 2026-11-06T09:30:00.000+0100 */
export function toJiraDate(date) {
  const p = (n, l = 2) => String(Math.abs(n)).padStart(l, '0');
  const off = -date.getTimezoneOffset();
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}.${p(date.getMilliseconds(), 3)}${off >= 0 ? '+' : '-'}${p(Math.floor(Math.abs(off) / 60))}${p(Math.abs(off) % 60)}`;
}

/** Date -> value for <input type="datetime-local">. */
export function toLocalInput(date) {
  const p = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())}T${p(date.getHours())}:${p(date.getMinutes())}`;
}

/** Extract an issue key from text or a URL (JiraKeyHelpers.ParseUrlToKey). */
export function parseKey(text) {
  const m = String(text || '').match(/[A-Z][A-Z0-9_]*-\d+/i);
  return m ? m[0].toUpperCase() : String(text || '').trim().toUpperCase();
}
