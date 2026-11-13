// Portions derived from Jira StopWatch, Copyright 2025 Carsten Gehling, Dan Tulloh, Y. Meyer-Norwood, et al.
// Licensed under the Apache License, Version 2.0 (see LICENSE). Modified: ported to a browser extension (JavaScript).
import * as store from './src/store.js';
import * as actions from './src/actions.js';

// ---- toolbar badge: shows running time of the active timer ----
async function updateBadge() {
  const [timers, settings] = await Promise.all([store.getTimers(), store.getSettings()]);
  const running = timers.filter(store.isRunning);
  if (!settings.showBadge || !running.length) {
    await chrome.action.setBadgeText({ text: '' });
    await chrome.action.setTitle({ title: 'Worklog Timer' });
    return;
  }
  const ms = Math.max(...running.map((t) => store.elapsed(t)));
  const mins = Math.floor(ms / 60000);
  const text = mins < 60 ? `${mins}m` : `${Math.floor(mins / 60)}:${String(mins % 60).padStart(2, '0')}`;
  await chrome.action.setBadgeBackgroundColor({ color: '#1f845a' });
  await chrome.action.setBadgeText({ text });
  await chrome.action.setTitle({ title: `Worklog Timer — running: ${running.map((t) => t.key || '(no issue)').join(', ')}` });
}

// Check for a gap whenever the worker wakes up (browser start, wake from sleep, any event).
const ready = actions.heartbeat();

function setup() {
  chrome.alarms.create('badge', { periodInMinutes: 0.5 });
  chrome.idle.setDetectionInterval(300);
  actions.syncRequestRules();
  updateBadge();
}
chrome.runtime.onInstalled.addListener((d) => {
  setup();
  if (d.reason === 'install') chrome.runtime.openOptionsPage();
});
chrome.runtime.onStartup.addListener(setup);

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== 'badge') return;
  await ready;
  await actions.heartbeat();
  updateBadge();
});

// Last browser window closed while the browser keeps running in the background (macOS, or
// Windows with "continue running background apps"): pause right away.
chrome.windows.onRemoved.addListener(async () => {
  const [settings, wins] = await Promise.all([store.getSettings(), chrome.windows.getAll()]);
  if (settings.pauseOnClose && wins.length === 0) await actions.autoPause(Date.now(), 'windows');
});
chrome.storage.onChanged.addListener((changes) => {
  if (changes.timers || changes.settings) updateBadge();
  if (changes.settings) {
    const o = changes.settings.oldValue?.baseUrl, n = changes.settings.newValue?.baseUrl;
    if (o !== n) actions.syncRequestRules();
  }
});

// ---- pause on screen lock (PauseOnSessionLock) ----
chrome.idle.onStateChanged.addListener(async (state) => {
  // On wake, first account for any sleep gap (this also cancels lock-resume after a long absence)
  await ready;
  await actions.heartbeat();
  const settings = await store.getSettings();
  if (settings.lockBehavior === 'none') return;
  if (state === 'locked') {
    const paused = await store.updateTimers((timers) => {
      const ids = [];
      for (const t of timers) if (store.isRunning(t)) { store.pauseTimer(t); ids.push(t.id); }
      return ids;
    });
    if (paused.length) await chrome.storage.local.set({ lockPaused: paused });
  } else if (state === 'active') {
    const { lockPaused = [] } = await chrome.storage.local.get('lockPaused');
    await chrome.storage.local.remove('lockPaused');
    if (settings.lockBehavior === 'pauseResume') for (const id of lockPaused) await actions.start(id);
  }
});

// ---- keyboard shortcut: toggle the most recently used timer ----
chrome.commands.onCommand.addListener(async (cmd) => {
  if (cmd !== 'toggle-timer') return;
  const timers = await store.getTimers();
  const t = timers.filter((x) => x.key).sort((a, b) => (b.lastUsed || 0) - (a.lastUsed || 0))[0];
  if (!t) return;
  const wasRunning = store.isRunning(t);
  await actions.toggle(t.id);
  chrome.notifications.create({
    type: 'basic', iconUrl: 'icons/icon128.png', title: 'Worklog Timer',
    message: `${wasRunning ? 'Paused' : 'Started'} ${t.key}${t.summary ? ' — ' + t.summary : ''}`,
  });
});

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'syncRules') { actions.syncRequestRules().then(() => reply(true)); return true; }
});
