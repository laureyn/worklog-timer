// Portions derived from Jira StopWatch, Copyright 2025 Carsten Gehling, Dan Tulloh, Y. Meyer-Norwood, et al.
// Licensed under the Apache License, Version 2.0 (see LICENSE). Modified: ported to a browser extension (JavaScript).
import * as store from './src/store.js';
import * as actions from './src/actions.js';
import { Jira, jqlString, splitOrderBy } from './src/jira.js';
import { clock, toJiraTime, parseJiraTime, parseTimeEdit, ceilMinute, toLocalInput, parseKey } from './src/time.js';

const $ = (s) => document.querySelector(s);
const isPanel = document.body.classList.contains('panel');

let settings, config, jira, timers = [], favourites = [];
let windowId = null;

// ---------- tiny DOM helper ----------
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k in el && k !== 'list') el[k] = v;
    else el.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
function toast(msg, ms = 2600) {
  const t = h('div', { class: 'toast' }, msg);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}
function banner(msg, isErr = false, link) {
  const b = $('#banner');
  if (!msg) { b.hidden = true; return; }
  b.replaceChildren(msg, link ? ' ' : '', link || '');
  b.className = 'banner' + (isErr ? ' err' : '');
  b.hidden = false;
}
const loginLink = () => h('a', { href: '#', onclick: (e) => { e.preventDefault(); chrome.tabs.create({ url: jira.base }); } }, 'Log in to Jira');
/** Show the right fix for an auth error: log in (browser-login mode) or check settings (token modes). */
function authBanner(e) {
  if (e.status !== 401 && e.status !== 403) return false;
  if (settings.authMode === 'session' && e.status === 401) banner('Your Jira login has expired.', true, loginLink());
  else banner(e.message, true, settingsLink());
  return true;
}
const settingsLink = () => h('a', { href: '#', onclick: (e) => { e.preventDefault(); chrome.runtime.openOptionsPage(); } }, 'Open settings');

// ---------- init ----------
async function load() {
  [settings, config, timers] = await Promise.all([store.getSettings(), store.getJiraConfig(), store.getTimers()]);
  jira = new Jira(settings, config);
}

async function init() {
  // The popup may open before the worker's alarm fires after a wake-up: check the gap first.
  await actions.heartbeat();
  await load();
  if (isPanel) $('#btnPanel').hidden = true;
  windowId = (await chrome.windows.getCurrent()).id;
  if (!chrome.sidePanel) $('#btnPanel').hidden = true;

  if (!jira.configured) banner('Connect to Jira to get started.', false, settingsLink());

  // Make sure there's always at least one row to type into
  if (!timers.length) await store.updateTimers((t) => { t.push(store.newTimer()); });

  renderTimers();
  showAutoPaused();
  fillDatalist(await store.getIssueCache());
  detectCurrentTab();
  setInterval(tick, 1000);

  if (jira.configured) {
    jira.favouriteFilters().then((f) => {
      favourites = f || [];
      if (favourites.length) {
        const g = h('optgroup', { label: 'Favourite filters' }, favourites.map((x) => h('option', { value: 'f:' + x.id }, x.name)));
        $('#scope').append(g);
      }
    }).catch(() => {});
    refreshIssueCache();
  }
}

chrome.storage.onChanged.addListener(async (changes) => {
  if (!jira) return; // still initialising; init() renders everything once loaded
  if (changes.settings || changes.jiraConfig) { await load(); renderTimers(); return; }
  if (changes.autoPaused) showAutoPaused();
  if (changes.timers) {
    timers = changes.timers.newValue || [];
    // Don't clobber a key the user is typing
    if (document.activeElement?.classList?.contains('keyInput')) return;
    renderTimers();
  }
});

// ---------- "paused while you were away" notice ----------
async function showAutoPaused() {
  const { autoPaused } = await chrome.storage.local.get('autoPaused');
  const box = $('#awayNote');
  if (!autoPaused) { box.hidden = true; return; }
  const when = new Date(autoPaused.at);
  const sameDay = when.toDateString() === new Date().toDateString();
  const time = when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const why = autoPaused.reason === 'windows' ? 'all browser windows were closed' : 'the browser was closed or the computer was asleep';
  box.replaceChildren(
    h('span', {}, `Paused ${autoPaused.keys.join(', ')} at ${sameDay ? time : when.toLocaleDateString() + ' ' + time} because ${why}.`),
    h('button', { class: 'btn ghost', onclick: async () => { await chrome.storage.local.remove('autoPaused'); box.hidden = true; } }, 'OK'));
  box.hidden = false;
}

// ---------- tabs ----------
document.querySelectorAll('.tab').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab)));
document.addEventListener('click', (e) => { const g = e.target.closest('[data-goto]'); if (g) { e.preventDefault(); showTab(g.dataset.goto); } });
function showTab(name) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.pane').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + name));
  if (name === 'search') { $('#q').focus(); if (!$('#results').children.length) runSearch(); }
}

$('#btnSettings').addEventListener('click', () => chrome.runtime.openOptionsPage());
$('#btnPanel').addEventListener('click', () => {
  // Must be called synchronously inside the click for the user-gesture requirement
  chrome.sidePanel.open({ windowId }).then(() => window.close()).catch((e) => toast('Side panel unavailable: ' + e.message));
});

// ---------- timers ----------
function renderTimers() {
  const list = $('#timerList');
  list.replaceChildren(...timers.map(timerRow));
  $('#timersEmpty').hidden = timers.length > 0;
  tick();
}

function timerRow(t) {
  const running = store.isRunning(t);
  const canLog = ceilMinute(store.elapsed(t)) >= 60000 && t.key;
  const li = h('li', { class: running ? 'running' : '', 'data-id': t.id },
    h('div', { class: 'row1' },
      h('input', {
        class: 'keyInput', value: t.key, placeholder: 'Issue key', list: 'issueKeys', spellcheck: false, title: 'Type or paste an issue key / URL',
        onchange: (e) => setKey(t.id, e.target.value),
        onkeydown: (e) => { if (e.key === 'Enter') e.target.blur(); },
      }),
      h('span', { class: 'summary', title: t.summary }, t.summary || ''),
      h('button', { class: 'play', title: running ? 'Pause' : 'Start', onclick: () => toggleTimer(t.id) }, running ? '❚❚' : '▶'),
    ),
    h('div', { class: 'row2' },
      h('button', { class: 'clock', 'data-clock': t.id, title: 'Click to edit time', onclick: () => openEdit(t.id) }, clock(store.elapsed(t))),
      t.comment ? h('span', { class: 'note', title: t.comment }, '✎ comment saved') : null,
      h('span', { class: 'spacer' }),
      h('button', { class: 'icon', title: 'Log work to Jira', disabled: !canLog, onclick: () => openLogForTimer(t.id) }, '⇪'),
      h('button', { class: 'icon', title: 'Reset', disabled: !running && !store.elapsed(t), onclick: () => resetTimer(t.id) }, '↺'),
      h('button', { class: 'icon', title: 'Open in Jira', disabled: !t.key || !jira.base, onclick: () => chrome.tabs.create({ url: jira.browseUrl(t.key) }) }, '↗'),
      h('button', { class: 'icon', title: 'Remove', onclick: () => removeTimer(t.id) }, '✕'),
    ),
  );
  return li;
}

function tick() {
  const now = Date.now();
  let total = 0;
  for (const t of timers) {
    const ms = store.elapsed(t, now);
    total += ms;
    const el = document.querySelector(`[data-clock="${t.id}"]`);
    if (el) el.textContent = clock(ms);
  }
  $('#total').textContent = clock(total);
}

async function setKey(id, raw) {
  const key = parseKey(raw);
  await store.updateTimers((ts) => { const t = ts.find((x) => x.id === id); if (t) { t.key = key; t.summary = ''; } });
  if (key && jira.configured) {
    try {
      const i = await jira.issue(key);
      const summary = settings.includeProjectName ? `${i.project}: ${i.summary}` : i.summary;
      await store.updateTimers((ts) => { const t = ts.find((x) => x.id === id); if (t && t.key === key) t.summary = summary; });
    } catch (e) { toast(`${key}: ${e.message}`); }
  }
  renderTimers();
}

async function toggleTimer(id) {
  const t = timers.find((x) => x.id === id);
  if (t && !store.isRunning(t) && !t.key) toast('Tip: set an issue key so you can log this time');
  const transitioned = await actions.toggle(id);
  if (transitioned) toast(`${t.key} → ${transitioned}`);
}

async function resetTimer(id) {
  const t = timers.find((x) => x.id === id);
  if (store.elapsed(t) > 60000 && !confirm(`Reset ${t.key || 'this timer'} (${clock(store.elapsed(t))})?`)) return;
  await store.updateTimers((ts) => store.resetTimer(ts.find((x) => x.id === id)));
}

async function removeTimer(id) {
  const t = timers.find((x) => x.id === id);
  if (store.elapsed(t) > 60000 && !confirm(`Remove ${t.key || 'this timer'} with ${clock(store.elapsed(t))} unlogged?`)) return;
  await store.updateTimers((ts) => { ts.splice(ts.findIndex((x) => x.id === id), 1); });
}

$('#btnAdd').addEventListener('click', async () => {
  await store.updateTimers((ts) => { ts.unshift(store.newTimer()); });
  setTimeout(() => document.querySelector('.keyInput')?.focus(), 30);
});

// Start tracking an issue from search / current tab
async function track(issue, startNow = true) {
  const summary = settings.includeProjectName && issue.project ? `${issue.project}: ${issue.summary}` : issue.summary;
  const id = await actions.ensureTimer(issue.key, summary);
  if (startNow) {
    const tr = await actions.start(id);
    toast(`Tracking ${issue.key}${tr ? ' → ' + tr : ''}`);
  }
  showTab('timers');
}

// ---------- current tab detection ----------
// Re-runs on navigation / tab switch / window focus, so a pinned side panel follows the page you're on.
let shownKey = null, detectSeq = 0;

function keyFromUrl(url) {
  if (!url || !jira.base || !url.startsWith(jira.base)) return null;
  const u = new URL(url);
  // Board / backlog / search views keep the open issue in ?selectedIssue= (or ?issueKey=)
  const m = (u.searchParams.get('selectedIssue') || u.searchParams.get('issueKey') || u.pathname).match(/[A-Z][A-Z0-9_]*-\d+/);
  return m ? m[0] : null;
}

async function detectCurrentTab() {
  const seq = ++detectSeq;
  let key = null;
  try {
    const query = windowId != null ? { active: true, windowId } : { active: true, lastFocusedWindow: true };
    const [tab] = await chrome.tabs.query(query);
    key = keyFromUrl(tab?.url);
  } catch { /* no access to tab URL */ }
  if (seq !== detectSeq) return;           // a newer check started meanwhile
  if (key === shownKey) return;           // nothing changed
  shownKey = key;
  const box = $('#currentTab');
  if (!key) { box.hidden = true; box.replaceChildren(); return; }

  const info = { key, summary: '', project: '' }; // per-key, so a previous ticket's title is never reused
  const summaryEl = h('span', { class: 'muted' }, 'open in this tab');
  box.replaceChildren(h('span', { class: 'grow' }, h('strong', {}, key), ' ', summaryEl),
    h('button', { class: 'btn primary', onclick: () => track(info) }, '▶ Track'),
    h('button', { class: 'btn', onclick: () => openLog(info) }, 'Log'));
  box.hidden = false;
  jira.issue(key).then((i) => {
    if (shownKey !== key) return;
    Object.assign(info, { summary: i.summary, project: i.project });
    summaryEl.textContent = i.summary;
    summaryEl.title = i.summary;
  }).catch(() => {});
}

let detectTimer;
const detectSoon = () => { clearTimeout(detectTimer); detectTimer = setTimeout(detectCurrentTab, 150); };
chrome.tabs.onActivated.addListener(detectSoon);
// Fires for full loads and for Jira's in-page (history.pushState) navigations
chrome.tabs.onUpdated.addListener((_id, change, tab) => { if (tab.active && (change.url || change.status === 'complete')) detectSoon(); });
chrome.windows.onFocusChanged.addListener((wid) => { if (wid !== chrome.windows.WINDOW_ID_NONE && !isPanel) detectSoon(); });

// ---------- search ----------
let searchSeq = 0, debounce;
$('#q').addEventListener('input', () => { clearTimeout(debounce); debounce = setTimeout(runSearch, 350); });
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') { clearTimeout(debounce); runSearch(); } });
$('#scope').addEventListener('change', runSearch);

function buildJql(q, scope) {
  let base;
  if (scope === 'mine') base = settings.myJql;
  else if (scope.startsWith('f:')) base = favourites.find((f) => 'f:' + f.id === scope)?.jql || '';
  else base = q ? 'ORDER BY updated DESC' : 'issue in issueHistory() ORDER BY lastViewed DESC';
  const { where, order } = splitOrderBy(base);
  const clauses = [];
  if (where) clauses.push(`(${where})`);
  if (q) clauses.push(`text ~ ${jqlString(q.replace(/[*?]/g, '') + '*')}`);
  return [clauses.join(' AND '), order || 'ORDER BY updated DESC'].filter(Boolean).join(' ');
}

async function runSearch() {
  const msg = $('#resultsMsg'), list = $('#results');
  if (!jira.configured) { list.replaceChildren(); msg.replaceChildren('Set up your Jira connection first. ', settingsLink()); msg.hidden = false; return; }
  const q = $('#q').value.trim(), scope = $('#scope').value;
  const seq = ++searchSeq;
  msg.replaceChildren(h('span', { class: 'spin' }, '◌'), ' Searching…'); msg.hidden = false;

  const looksLikeKey = /^[A-Z][A-Z0-9_]*-\d+$/i.test(q);
  const tasks = [jira.search(buildJql(looksLikeKey ? '' : q, scope), 50).catch((e) => e)];
  if (looksLikeKey) tasks.push(jira.issue(q.toUpperCase()).then((i) => [i]).catch(() => []));
  const [main, byKey = []] = await Promise.all(tasks);
  if (seq !== searchSeq) return;

  if (main instanceof Error) {
    authBanner(main);
    list.replaceChildren();
    msg.textContent = main.message; msg.hidden = false; return;
  }
  banner(jira.configured ? '' : 'Connect to Jira to get started.', false, jira.configured ? null : settingsLink());
  let issues = main;
  if (looksLikeKey) issues = [...byKey, ...main.filter((i) => i.key.toUpperCase() === q.toUpperCase() ? false : true).filter((i) => i.key.toUpperCase().startsWith(q.toUpperCase()))];
  if (!q && scope === 'mine') { store.setIssueCache(issues); fillDatalist(issues); }

  list.replaceChildren(...issues.map(resultRow));
  msg.hidden = issues.length > 0;
  msg.textContent = issues.length ? '' : (q ? 'No matching issues.' : 'Nothing here — no unresolved issues assigned to you.');
}

function resultRow(i) {
  const tracked = timers.find((t) => t.key === i.key);
  return h('li', {},
    i.typeIcon ? h('img', { class: 'typeicon', src: i.typeIcon, alt: i.type, title: i.type }) : null,
    h('div', { class: 'info' },
      h('span', { class: 's', title: i.summary }, h('span', { class: 'k' }, i.key), i.summary),
      h('span', {}, h('span', { class: 'status ' + i.statusCategory }, i.status),
        tracked && store.isRunning(tracked) ? h('span', { class: 'tracking' }, '  ● tracking') : null,
        i.remaining ? h('span', { class: 'muted small' }, `  ${i.remaining} left`) : null),
    ),
    h('div', { class: 'actions' },
      h('button', { class: 'icon', title: 'Start timer', onclick: () => track(i) }, '▶'),
      h('button', { class: 'icon', title: 'Add timer without starting', onclick: () => track(i, false) }, '＋'),
      h('button', { class: 'icon', title: 'Log time directly', onclick: () => openLog({ key: i.key, summary: i.summary }) }, '⇪'),
      h('button', { class: 'icon', title: 'Open in Jira', onclick: () => chrome.tabs.create({ url: jira.browseUrl(i.key) }) }, '↗'),
    ),
  );
}

async function refreshIssueCache() {
  try {
    const issues = await jira.search(settings.myJql, 100);
    await store.setIssueCache(issues);
    fillDatalist(issues);
  } catch (e) {
    authBanner(e);
  }
}
function fillDatalist(issues) {
  $('#issueKeys').replaceChildren(...issues.map((i) => h('option', { value: i.key }, i.summary)));
}

// ---------- worklog dialog ----------
const dlgLog = $('#dlgLog');
let logCtx = null;

function openLogForTimer(id) {
  const t = timers.find((x) => x.id === id);
  openLog({ key: t.key, summary: t.summary, timerId: t.id, ms: ceilMinute(store.elapsed(t)), started: store.initialStart(t),
    comment: t.comment, estimateMethod: t.estimateMethod, estimateValue: t.estimateValue });
}

function openLog(ctx) {
  logCtx = ctx;
  $('#logKey').textContent = ctx.key;
  $('#logSummary').textContent = ctx.summary || '';
  $('#logTime').value = ctx.ms ? toJiraTime(ctx.ms, config.hoursPerDay) : '';
  $('#logStarted').value = toLocalInput(new Date(ctx.started || Date.now() - (ctx.ms || 0)));
  $('#logComment').value = ctx.comment || '';
  const m = ctx.estimateMethod || 'auto';
  dlgLog.querySelectorAll('input[name=est]').forEach((r) => (r.checked = r.value === m));
  $('#estNew').value = m === 'new' ? ctx.estimateValue : '';
  $('#estReduce').value = m === 'manual' ? ctx.estimateValue : '';
  $('#logRemaining').textContent = '';
  $('#logError').hidden = true;
  $('#logSaveComment').hidden = !ctx.timerId;
  $('#logSubmit').disabled = false;
  dlgLog.showModal();
  (ctx.ms ? $('#logComment') : $('#logTime')).focus();
  jira.issue(ctx.key).then((i) => {
    if (logCtx !== ctx) return;
    $('#logRemaining').textContent = i.remaining ? `(currently ${i.remaining})` : '(none set)';
    if (!ctx.summary) $('#logSummary').textContent = i.summary;
  }).catch(() => {});
}

function readEstimate() {
  const method = dlgLog.querySelector('input[name=est]:checked').value;
  const value = method === 'new' ? $('#estNew').value.trim() : method === 'manual' ? $('#estReduce').value.trim() : '';
  return { method, value };
}
['estNew', 'estReduce'].forEach((id) => $('#' + id).addEventListener('focus', (e) => (e.target.closest('label').querySelector('input[type=radio]').checked = true)));

$('#logCancel').addEventListener('click', () => dlgLog.close());
$('#logSaveComment').addEventListener('click', async () => {
  const { method, value } = readEstimate();
  const text = $('#logComment').value.trim();
  const stamped = text && !logCtx.comment ? `${new Date().toLocaleString()}:\n${text}` : text;
  await store.updateTimers((ts) => {
    const t = ts.find((x) => x.id === logCtx.timerId);
    if (t) Object.assign(t, { comment: stamped, estimateMethod: method, estimateValue: value });
  });
  dlgLog.close();
  toast('Comment saved on timer');
});

$('#logForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const err = $('#logError');
  const ms = parseJiraTime($('#logTime').value, config.hoursPerDay, config.daysPerWeek);
  const { method, value } = readEstimate();
  const fail = (m) => { err.textContent = m; err.hidden = false; };
  if (!ms || ms < 60000) return fail('Enter a time of at least 1m, e.g. "1h 30m".');
  if ((method === 'new' || method === 'manual') && parseJiraTime(value, config.hoursPerDay, config.daysPerWeek) == null) return fail('Enter a valid estimate, e.g. "2h".');
  const started = new Date($('#logStarted').value).getTime();
  if (!started) return fail('Enter a valid start date/time.');
  // If the timer kept running while the dialog was open, log what's shown in the dialog.
  $('#logSubmit').disabled = true; err.hidden = true;
  try {
    await actions.logWork({ key: logCtx.key, timerId: logCtx.timerId, started, ms, comment: $('#logComment').value, estimateMethod: method, estimateValue: value });
    dlgLog.close();
    toast(`Logged ${toJiraTime(ms, config.hoursPerDay)} to ${logCtx.key}`);
  } catch (ex) {
    authBanner(ex);
    fail(ex.message);
    $('#logSubmit').disabled = false;
  }
});

// ---------- edit time dialog ----------
const dlgEdit = $('#dlgEdit');
let editId = null;
function openEdit(id) {
  editId = id;
  const t = timers.find((x) => x.id === id);
  $('#editTime').value = toJiraTime(store.elapsed(t), config.hoursPerDay);
  $('#editError').hidden = true;
  dlgEdit.showModal();
  $('#editTime').select();
}
dlgEdit.querySelectorAll('[data-adj]').forEach((b) => b.addEventListener('click', () => {
  const cur = parseJiraTime($('#editTime').value, config.hoursPerDay, config.daysPerWeek) ?? 0;
  const v = parseTimeEdit(b.dataset.adj.replace('−', '-'), cur, config.hoursPerDay, config.daysPerWeek);
  $('#editTime').value = toJiraTime(v, config.hoursPerDay);
}));
$('#editCancel').addEventListener('click', () => dlgEdit.close());
$('#editForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  const t = timers.find((x) => x.id === editId);
  const v = parseTimeEdit($('#editTime').value.replace('−', '-'), store.elapsed(t), config.hoursPerDay, config.daysPerWeek);
  if (v == null) { $('#editError').textContent = 'Use a format like 1h 30m, 45m, 1:15 or +10m.'; $('#editError').hidden = false; return; }
  await store.updateTimers((ts) => store.setElapsed(ts.find((x) => x.id === editId), v));
  dlgEdit.close();
});

init();
