// Portions derived from Jira StopWatch, Copyright 2025 Carsten Gehling, Dan Tulloh, Y. Meyer-Norwood, et al.
// Licensed under the Apache License, Version 2.0 (see LICENSE). Modified: ported to a browser extension (JavaScript).
// Higher-level operations shared by popup, side panel and service worker.
import { Jira, normalizeBaseUrl } from './jira.js';
import * as store from './store.js';
import { ceilMinute } from './time.js';

export async function client() {
  const [settings, config] = await Promise.all([store.getSettings(), store.getJiraConfig()]);
  const jira = new Jira(settings, config);
  jira.onXsrf = syncRequestRules;
  jira.viaTab = runInJiraTab;
  return jira;
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
  const base = normalizeBaseUrl(baseUrl);
  if (!base) { await chrome.storage.local.remove('ruleError'); return { ok: false, reason: 'no-url' }; }
  const host = new URL(base).hostname;
  const action = { type: 'modifyHeaders', requestHeaders: [{ header: 'origin', operation: 'remove' }] };
  const rules = [
    // 1: requests made by this extension's own pages and worker (initiator = extension origin)
    { id: 1, priority: 1, action, condition: { requestDomains: [host], initiatorDomains: [chrome.runtime.id], resourceTypes: ['xmlhttprequest', 'other'] } },
    // 2: fallback for requests not attached to any tab, matched without the initiator condition
    { id: 2, priority: 1, action, condition: { requestDomains: [host], tabIds: [-1], resourceTypes: ['xmlhttprequest', 'other'] } },
  ];
  let error = '';
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [1, 2], addRules: rules });
    const active = await chrome.declarativeNetRequest.getSessionRules();
    if (!active.some((r) => r.id === 1)) error = 'The browser did not keep the Origin rule.';
  } catch (e) {
    error = e?.message || String(e);
    console.warn('DNR rule failed', e);
  }
  if (error) await chrome.storage.local.set({ ruleError: error });
  else await chrome.storage.local.remove('ruleError');
  return { ok: !error, reason: error || 'ok' };
}

function waitForLoad(tabId) {
  return new Promise((resolve) => {
    const done = () => { chrome.tabs.onUpdated.removeListener(listener); resolve(); };
    const listener = (id, info) => { if (id === tabId && info.status === 'complete') done(); };
    chrome.tabs.onUpdated.addListener(listener);
    setTimeout(done, 15000);
  });
}

/**
 * Runs a Jira request from inside a page on the Jira site, so Jira sees its own origin.
 * Uses an open Jira tab if there is one, otherwise opens one in the background and closes it afterwards.
 */
export async function runInJiraTab(url, init) {
  const origin = new URL(url).origin;
  let [tab] = await chrome.tabs.query({ url: origin + '/*' });
  let created = false;
  if (!tab) {
    tab = await chrome.tabs.create({ url: origin + '/', active: false });
    created = true;
    await waitForLoad(tab.id);
  }
  try {
    const [out] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      world: 'MAIN',
      args: [url, init],
      func: async (u, i) => {
        const r = await fetch(u, { ...i, credentials: 'include' });
        return { status: r.status, text: await r.text() };
      },
    });
    if (!out?.result) throw new Error('No response from the Jira tab.');
    return out.result;
  } finally {
    if (created) chrome.tabs.remove(tab.id).catch(() => {});
  }
}

/**
 * Sends a write request that Jira can't act on: no body, and a made-up issue key. Jira checks the
 * XSRF header before it looks at the issue, so a 403 XSRF means the Origin header still arrives,
 * and any other answer means the write itself is accepted.
 */
export async function writeCheck(jira) {
  try {
    await jira.req('/rest/api/2/issue/NOPE-0/worklog', { method: 'POST', body: {} });
    return 'accepted';
  } catch (e) {
    if (e.xsrf) return `rejected by XSRF check (HTTP ${e.status}), even after the fallback: ${e.body || 'no body'}`;
    return `reached Jira (HTTP ${e.status}): ${e.message}`;
  }
}

/** Human-readable state of everything that decides whether Jira accepts requests from the extension. */
export async function diagnose(withWriteCheck = true) {
  const lines = [];
  const { baseUrl } = await store.getSettings();
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return ['Jira URL is not set.'];
  const host = new URL(base).hostname;
  lines.push(`Jira site: ${host}`);
  lines.push(`Site permission granted: ${await chrome.permissions.contains({ origins: [new URL(base).origin + '/*'] })}`);
  const rules = await chrome.declarativeNetRequest.getSessionRules();
  lines.push(`Origin rules active: ${rules.map((r) => r.id).join(', ') || 'none'}`);
  const { ruleError } = await chrome.storage.local.get('ruleError');
  if (ruleError) lines.push(`Last rule error: ${ruleError}`);
  if (withWriteCheck) lines.push(`Write check: ${await writeCheck(await client())}`);
  return lines;
}


/** Why Jira might still reject requests: missing site permission, or the Origin rule isn't active. */
export async function requestDiagnosis() {
  const { baseUrl } = await store.getSettings();
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return 'Enter your Jira URL in Settings.';
  const origin = new URL(base).origin + '/*';
  if (!(await chrome.permissions.contains({ origins: [origin] }))) {
    return `Access to ${new URL(base).host} is not granted. Open Settings and click Save to allow it.`;
  }
  const { ruleError } = await chrome.storage.local.get('ruleError');
  if (ruleError) return `The browser refused the Origin rule: ${ruleError}`;
  return null;
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
