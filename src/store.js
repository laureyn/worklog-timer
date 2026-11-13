// Portions derived from Jira StopWatch, Copyright 2025 Carsten Gehling, Dan Tulloh, Y. Meyer-Norwood, et al.
// Licensed under the Apache License, Version 2.0 (see LICENSE). Modified: ported to a browser extension (JavaScript).
// Persistent state (replaces Settings.cs / PersistedIssue / WatchTimer).
// Timers are stored as data, not as ticking objects, so the popup can close at any time
// and the service worker can sleep — elapsed time is always derived from timestamps.

export const DEFAULT_SETTINGS = {
  baseUrl: '',
  authMode: 'token',          // 'token' (Cloud: email + API token) | 'pat' (Server/DC bearer) | 'session' (browser cookies)
  email: '',
  apiToken: '',
  allowMultipleTimers: false,
  includeProjectName: false,
  postMode: 'worklog',        // 'worklog' | 'comment' | 'both'   (WorklogCommentSetting)
  lockBehavior: 'pause',      // 'none' | 'pause' | 'pauseResume' (PauseAndResumeSetting)
  pauseOnClose: true,         // pause when the browser is closed / computer sleeps
  startTransitions: 'In Progress\nStart Progress',
  myJql: 'assignee = currentUser() AND resolution = Unresolved ORDER BY updated DESC',
  showBadge: true,
};

const DEFAULT_JIRA_CONFIG = { hoursPerDay: 8, daysPerWeek: 5, deployment: '', displayName: '' };

export async function getSettings() {
  const { settings } = await chrome.storage.local.get('settings');
  return { ...DEFAULT_SETTINGS, ...(settings || {}) };
}
export async function saveSettings(patch) {
  const s = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: s });
  return s;
}
export async function getJiraConfig() {
  const { jiraConfig } = await chrome.storage.local.get('jiraConfig');
  return { ...DEFAULT_JIRA_CONFIG, ...(jiraConfig || {}) };
}
export async function saveJiraConfig(patch) {
  await chrome.storage.local.set({ jiraConfig: { ...(await getJiraConfig()), ...patch } });
}

// ---------- timers ----------

export function newTimer(key = '', summary = '') {
  return {
    id: crypto.randomUUID(),
    key, summary,
    accumulatedMs: 0,
    startedAt: null,       // epoch ms of current run, null when paused
    firstStartedAt: null,  // first time play was pressed (for worklog "started")
    lastUsed: Date.now(),
    comment: '',
    estimateMethod: 'auto',
    estimateValue: '',
  };
}

export const elapsed = (t, now = Date.now()) => t.accumulatedMs + (t.startedAt ? now - t.startedAt : 0);
export const isRunning = (t) => t.startedAt != null;

/** WatchTimer.GetInitialStartTime: earliest of "first pressed play" and "now − elapsed". */
export function initialStart(t, now = Date.now()) {
  const estimated = now - elapsed(t, now);
  return !t.firstStartedAt || estimated < t.firstStartedAt ? estimated : t.firstStartedAt;
}

export async function getTimers() {
  const { timers } = await chrome.storage.local.get('timers');
  return timers || [];
}

// Serialise read-modify-write within one JS context.
let chain = Promise.resolve();
export function updateTimers(fn) {
  const run = chain.then(async () => {
    const timers = await getTimers();
    const result = await fn(timers);
    await chrome.storage.local.set({ timers });
    return result;
  });
  chain = run.catch(() => {});
  return run;
}

export function startTimer(timers, id, allowMultiple) {
  const now = Date.now();
  for (const t of timers) {
    if (t.id === id) {
      if (!t.startedAt) t.startedAt = now;
      if (!t.firstStartedAt) t.firstStartedAt = now;
      t.lastUsed = now;
    } else if (!allowMultiple && t.startedAt) {
      pauseTimer(t, now);
    }
  }
}
export function pauseTimer(t, now = Date.now()) {
  if (!t.startedAt) return;
  t.accumulatedMs += now - t.startedAt;
  t.startedAt = null;
  t.lastUsed = now;
}
export function resetTimer(t) {
  Object.assign(t, { accumulatedMs: 0, startedAt: null, firstStartedAt: null, comment: '', estimateMethod: 'auto', estimateValue: '' });
}
export function setElapsed(t, ms, now = Date.now()) {
  t.accumulatedMs = ms;
  if (t.startedAt) t.startedAt = now;
}

// Cached "my issues" list for autocomplete.
export async function getIssueCache() {
  const { issueCache } = await chrome.storage.local.get('issueCache');
  return issueCache || [];
}
export async function setIssueCache(list) {
  await chrome.storage.local.set({ issueCache: list.slice(0, 200) });
}
