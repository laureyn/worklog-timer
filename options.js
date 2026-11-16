// Portions derived from Jira StopWatch, Copyright 2025 Carsten Gehling, Dan Tulloh, Y. Meyer-Norwood, et al.
// Licensed under the Apache License, Version 2.0 (see LICENSE). Modified: ported to a browser extension (JavaScript).
import * as store from './src/store.js';
import { Jira, normalizeBaseUrl } from './src/jira.js';
import { diagnose } from './src/actions.js';

const $ = (s) => document.querySelector(s);
const fields = ['baseUrl', 'authMode', 'email', 'apiToken', 'allowMultipleTimers', 'includeProjectName', 'showBadge', 'pauseOnClose',
  'lockBehavior', 'startTransitions', 'postMode', 'myJql'];

function status(msg, kind = '') { const s = $('#status'); s.textContent = msg; s.className = kind; }

function read() {
  const out = {};
  for (const f of fields) { const el = $('#' + f); out[f] = el.type === 'checkbox' ? el.checked : el.value.trim(); }
  out.baseUrl = normalizeBaseUrl(out.baseUrl);
  if (!out.myJql) out.myJql = store.DEFAULT_SETTINGS.myJql;
  // Browser-login mode: don't keep any credentials around
  if (out.authMode === 'session') { out.email = ''; out.apiToken = ''; $('#email').value = ''; $('#apiToken').value = ''; }
  return out;
}

async function init() {
  const s = await store.getSettings();
  for (const f of fields) { const el = $('#' + f); if (el.type === 'checkbox') el.checked = !!s[f]; else el.value = s[f] ?? ''; }
  syncAuth();
  const c = await store.getJiraConfig();
  if (c.displayName) status(`Connected as ${c.displayName}${c.deployment ? ` (${c.deployment})` : ''}`, 'ok');
}
function syncAuth() { $('#authCard').dataset.auth = $('#authMode').value; }
$('#authMode').addEventListener('change', syncAuth);

function originPattern(base) { return new URL(base).origin + '/*'; }

/** Ask for host access. Must run before any await in the click handler (user-gesture requirement). */
function requestAccess(base) {
  return chrome.permissions.request({ origins: [originPattern(base)] });
}

async function test(s) {
  status('Connecting…');
  const jira = new Jira(s);
  try {
    const [me, info] = await Promise.all([jira.myself(), jira.serverInfo().catch(() => ({}))]);
    const tt = await jira.timeTrackingConfig();
    const deployment = info.deploymentType || (/\.atlassian\.net$/.test(new URL(s.baseUrl).hostname) ? 'Cloud' : '');
    await store.saveJiraConfig({ ...tt, deployment, displayName: me.displayName || me.name || '' });
    status(`✓ Connected as ${me.displayName || me.name}${deployment ? ` (${deployment})` : ''} · ${tt.hoursPerDay}h working day`, 'ok');
    return true;
  } catch (e) {
    status('✕ ' + e.message, 'err');
    return false;
  }
}

$('#f').addEventListener('submit', (e) => {
  e.preventDefault();
  const s = read();
  if (!s.baseUrl) return status('Enter your Jira URL.', 'err');
  requestAccess(s.baseUrl).then(async (granted) => {
    if (!granted) return status('The extension needs access to your Jira site to work.', 'err');
    $('#baseUrl').value = s.baseUrl;
    await store.saveSettings(s);
    await chrome.runtime.sendMessage({ type: 'syncRules' }).catch(() => {});
    await test(s);
  });
});

$('#btnTest').addEventListener('click', () => {
  const s = read();
  if (!s.baseUrl) return status('Enter your Jira URL.', 'err');
  requestAccess(s.baseUrl).then(async (granted) => {
    if (!granted) return status('Access to the Jira site was not granted.', 'err');
    await store.saveSettings({ baseUrl: s.baseUrl });
    await chrome.runtime.sendMessage({ type: 'syncRules' }).catch(() => {});
    await test(s);
  });
});

$('#btnDiag').addEventListener('click', async () => {
  $('#diag').textContent = 'Running…';
  $('#diag').textContent = (await diagnose(true)).join('\n');
});

init();
