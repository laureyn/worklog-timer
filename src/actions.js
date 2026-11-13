// Portions derived from Jira StopWatch, Copyright 2025 Carsten Gehling, Dan Tulloh, Y. Meyer-Norwood, et al.
// Licensed under the Apache License, Version 2.0 (see LICENSE). Modified: ported to a browser extension (JavaScript).
// Higher-level operations shared by popup, side panel and service worker.
import { Jira, normalizeBaseUrl } from './jira.js';
import * as store from './store.js';
import { ceilMinute } from './time.js';

export async function client() {
  const [settings, config] = await Promise.all([store.getSettings(), store.getJiraConfig()]);
  return new Jira(settings, config);
}

/** Start a timer (pausing others unless multiple timers are allowed) and apply the start transition. */
export async function start(id) {
  const settings = await store.getSettings();
  const key = await store.updateTimers((timers) => {
    store.startTimer(timers, id, settings.allowMultipleTimers);
    return timers.find((t) => t.id === id)?.key;
  });
  if (key && settings.startTransitions.trim()) {
    try { return await (await client()).applyStartTransition(key, settings.startTransitions); }
    catch { /* transition is best-effort, like the desktop app */ }
  }
  return null;
}

export function pause(id) {
  return store.updateTimers((timers) => { const t = timers.find((x) => x.id === id); if (t) store.pauseTimer(t); });
}

export async function toggle(id) {
  const t = (await store.getTimers()).find((x) => x.id === id);
  if (!t) return;
  return store.isRunning(t) ? pause(id) : start(id);
}

/** Find or create a timer for an issue key. */
export function ensureTimer(key, summary = '') {
  return store.updateTimers((timers) => {
    let t = timers.find((x) => x.key && x.key.toUpperCase() === key.toUpperCase());
    if (!t) {
      // Reuse an empty unused row if there is one
      t = timers.find((x) => !x.key && store.elapsed(x) === 0);
      if (t) Object.assign(t, { key, summary });
      else { t = store.newTimer(key, summary); timers.unshift(t); }
    } else if (summary && !t.summary) t.summary = summary;
    return t.id;
  });
}

/**
 * Port of IssueControl.PostAndReset: optionally post the comment as an issue comment,
 * then post the worklog, then reset the timer (if one was used).
 */
export async function logWork({ key, timerId, started, ms, comment, estimateMethod, estimateValue }) {
  const settings = await store.getSettings();
  const jira = await client();
  let worklogComment = (comment || '').trim();
  if (settings.postMode !== 'worklog' && worklogComment) {
    await jira.postComment(key, worklogComment);
    if (settings.postMode === 'comment') worklogComment = '';
  }
  await jira.postWorklog(key, { started, ms: ceilMinute(ms), comment: worklogComment, estimateMethod, estimateValue });
  if (timerId) {
    await store.updateTimers((timers) => { const t = timers.find((x) => x.id === timerId); if (t) store.resetTimer(t); });
  }
}

/**
 * Remove the Origin header on the extension's own requests to the Jira host.
 * Jira's XSRF filter rejects POSTs whose Origin is chrome-extension://…
 * Scoped by initiatorDomains to this extension's own requests, so normal Jira tabs are untouched.
 */
export async function syncRequestRules() {
  const { baseUrl } = await store.getSettings();
  const rules = [];
  const base = normalizeBaseUrl(baseUrl);
  if (base) {
    rules.push({
      id: 1, priority: 1,
      action: { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'remove' }] },
      condition: { requestDomains: [new URL(base).hostname], initiatorDomains: [chrome.runtime.id], resourceTypes: ['xmlhttprequest', 'other'] },
    });
  }
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1], addRules: rules });
  } catch (e) { console.warn('DNR rule failed', e); }
}

// ---------- pause when the browser was closed / the computer slept ----------
// There is no reliable "browser is quitting" or "computer is going to sleep" event, so the
// service worker writes a heartbeat every 30 s. A gap longer than GAP_MS means the browser wasn't
// running (closed, shut down, asleep, crashed): running timers are paused as of the last heartbeat.

export const GAP_MS = 5 * 60_000;

/** Pause running timers as of `at` (epoch ms). Records what happened for the popup to show. */
export async function autoPause(at, reason) {
  const paused = await store.updateTimers((timers) => {
    const out = [];
    for (const t of timers) {
      // Only timers that were already running at `at`; anything started later is legitimate.
      if (t.startedAt && t.startedAt < at) {
        t.accumulatedMs += at - t.startedAt;
        t.startedAt = null;
        out.push(t.key || '(no issue)');
      }
    }
    return out;
  });
  if (paused.length) await chrome.storage.local.set({ autoPaused: { keys: paused, at, reason } });
  return paused;
}

/** Call on every wake-up: detects a gap since the last heartbeat, then records a new heartbeat. */
export async function heartbeat() {
  const now = Date.now();
  const [{ lastBeat }, settings] = await Promise.all([chrome.storage.local.get('lastBeat'), store.getSettings()]);
  let gap = false;
  if (lastBeat && now - lastBeat > GAP_MS) {
    gap = true;
    if (settings.pauseOnClose) {
      await autoPause(lastBeat, 'away');
      // After a long absence don't auto-resume timers that were paused by a screen lock.
      await chrome.storage.local.remove('lockPaused');
    }
  }
  await chrome.storage.local.set({ lastBeat: now });
  return gap;
}
