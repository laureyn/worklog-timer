// Portions derived from Jira StopWatch, Copyright 2025 Carsten Gehling, Dan Tulloh, Y. Meyer-Norwood, et al.
// Licensed under the Apache License, Version 2.0 (see LICENSE). Modified: ported to a browser extension (JavaScript).
// Port of JiraClient / JiraApiRequestFactory / JiraApiRequester using fetch().
// Updated for current Jira: Cloud search uses /search/jql (the old /search was removed),
// session validation uses /myself (the /rest/auth/1/session endpoint is not on Cloud).

import { toJiraDate, toJiraTime } from './time.js';

export class JiraError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

export function normalizeBaseUrl(url) {
  let u = String(url || '').trim();
  if (!u) return '';
  if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
  const parsed = new URL(u);
  // Keep a context path (e.g. https://host/jira) but drop anything after /browse, /jira/software, etc.
  let path = parsed.pathname.replace(/\/(browse|secure|projects|jira\/(software|core|servicedesk|your-work)|issues)(\/.*)?$/i, '');
  path = path.replace(/\/+$/, '');
  return parsed.origin + path;
}

const ISSUE_FIELDS = 'summary,status,project,issuetype,priority,timetracking';

export class Jira {
  constructor(settings, config = {}) {
    this.s = settings;
    this.base = normalizeBaseUrl(settings.baseUrl);
    this.hoursPerDay = config.hoursPerDay || 8;
    this.deployment = config.deployment || '';
  }

  get configured() {
    if (!this.base) return false;
    if (this.s.authMode === 'token') return !!(this.s.email && this.s.apiToken);
    if (this.s.authMode === 'pat') return !!this.s.apiToken;
    return true;
  }

  /** Sends a request. If Jira refuses it for an XSRF check, restore the Origin rule and retry once. */
  async req(path, opts = {}) {
    try {
      return await this.send(path, opts);
    } catch (e) {
      if (!e.xsrf || opts.retried || !this.onXsrf) throw e;
      await this.onXsrf();
      return this.send(path, { ...opts, retried: true });
    }
  }

  async send(path, { method = 'GET', query, body, retried } = {}) {
    if (!this.base) throw new JiraError('Jira URL is not set — open Settings.', 0);
    const url = new URL(this.base + path);
    for (const [k, v] of Object.entries(query || {})) if (v != null && v !== '') url.searchParams.set(k, v);
    const headers = { Accept: 'application/json', 'X-Atlassian-Token': 'no-check' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.s.authMode === 'token') headers.Authorization = 'Basic ' + btoa(unescape(encodeURIComponent(`${this.s.email}:${this.s.apiToken}`)));
    else if (this.s.authMode === 'pat') headers.Authorization = 'Bearer ' + this.s.apiToken;

    let res;
    try {
      res = await fetch(url, {
        method, headers,
        body: body !== undefined ? JSON.stringify(body) : undefined,
        credentials: this.s.authMode === 'session' ? 'include' : 'omit',
      });
    } catch (e) {
      throw new JiraError(`Can't reach ${url.host}. Check the URL and that the extension has permission for this site (Settings → Save).`, 0);
    }
    const text = await res.text();
    let data = null;
    try { data = text ? JSON.parse(text) : null; } catch { /* HTML error page */ }
    if (!res.ok) {
      let msg = '';
      if (data) msg = [...(data.errorMessages || []), ...Object.values(data.errors || {})].join(' ') || data.message || '';
      if (!msg) msg = {
        401: this.s.authMode === 'session' ? 'Not logged in to Jira in this browser — open Jira, log in, then try again.' : 'Authentication failed — check email / token.',
        403: 'Permission denied (403).',
        404: 'Not found (404).',
      }[res.status] || `Jira returned HTTP ${res.status}.`;
      const xsrf = /xsrf/i.test(text);
      if (xsrf) msg = 'Jira rejected the request (XSRF check). The extension could not restore its request rule. Open Settings and click Save.';
      const err = new JiraError(msg, res.status);
      err.xsrf = xsrf;
      throw err;
    }
    return data;
  }

  myself() { return this.req('/rest/api/2/myself'); }
  serverInfo() { return this.req('/rest/api/2/serverInfo'); }

  async timeTrackingConfig() {
    try {
      const c = await this.req('/rest/api/2/configuration');
      const t = c?.timeTrackingConfiguration;
      if (t) return { hoursPerDay: t.workingHoursPerDay || 8, daysPerWeek: t.workingDaysPerWeek || 5 };
    } catch { /* time tracking config may be hidden; fall back to defaults */ }
    return { hoursPerDay: 8, daysPerWeek: 5 };
  }

  favouriteFilters() { return this.req('/rest/api/2/filter/favourite'); }

  async search(jql, maxResults = 50) {
    const query = { jql, maxResults, fields: ISSUE_FIELDS };
    const cloudFirst = this.deployment !== 'Server' && this.deployment !== 'DataCenter';
    const paths = cloudFirst ? ['/rest/api/2/search/jql', '/rest/api/2/search'] : ['/rest/api/2/search', '/rest/api/2/search/jql'];
    let lastErr;
    for (const p of paths) {
      try {
        const r = await this.req(p, { query });
        return (r?.issues || []).map(simplifyIssue);
      } catch (e) {
        lastErr = e;
        if (![404, 405, 410].includes(e.status)) throw e;
      }
    }
    throw lastErr;
  }

  async issue(key) {
    return simplifyIssue(await this.req(`/rest/api/2/issue/${encodeURIComponent(key)}`, { query: { fields: ISSUE_FIELDS } }));
  }

  /** estimateMethod: auto | leave | new | manual (matches EstimateUpdateMethods). */
  postWorklog(key, { started, ms, comment, estimateMethod = 'auto', estimateValue = '' }) {
    const query = { adjustEstimate: estimateMethod };
    if (estimateMethod === 'new') query.newEstimate = estimateValue;
    if (estimateMethod === 'manual') query.reduceBy = estimateValue;
    return this.req(`/rest/api/2/issue/${encodeURIComponent(key)}/worklog`, {
      method: 'POST', query,
      body: { timeSpent: toJiraTime(ms, this.hoursPerDay), started: toJiraDate(new Date(started)), ...(comment ? { comment } : {}) },
    });
  }

  postComment(key, body) {
    return this.req(`/rest/api/2/issue/${encodeURIComponent(key)}/comment`, { method: 'POST', body: { body } });
  }

  async transitions(key) {
    return (await this.req(`/rest/api/2/issue/${encodeURIComponent(key)}/transitions`))?.transitions || [];
  }
  doTransition(key, id) {
    return this.req(`/rest/api/2/issue/${encodeURIComponent(key)}/transitions`, { method: 'POST', body: { transition: { id: String(id) } } });
  }

  /** MainForm "start transitions": first available transition whose name contains one of the configured names. */
  async applyStartTransition(key, namesText) {
    const names = String(namesText || '').split('\n').map((l) => l.trim().toLowerCase()).filter(Boolean);
    if (!names.length) return null;
    const list = await this.transitions(key);
    const t = list.find((tr) => names.some((n) => tr.name.toLowerCase().includes(n)));
    if (!t) return null;
    await this.doTransition(key, t.id);
    return t.name;
  }

  browseUrl(key) { return `${this.base}/browse/${encodeURIComponent(key)}`; }
}

function simplifyIssue(i) {
  const f = i.fields || {};
  return {
    key: i.key,
    summary: f.summary || '',
    project: f.project?.name || '',
    status: f.status?.name || '',
    statusCategory: f.status?.statusCategory?.key || '',
    type: f.issuetype?.name || '',
    typeIcon: f.issuetype?.iconUrl || '',
    remaining: f.timetracking?.remainingEstimate || '',
  };
}

/** Escape user text for a JQL string literal. */
export const jqlString = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

/** Split "… ORDER BY …" so extra clauses can be ANDed in. */
export function splitOrderBy(jql) {
  const s = String(jql || '');
  const i = s.search(/(^|\s)order\s+by\s/i);
  if (i < 0) return { where: s.trim(), order: '' };
  return { where: s.slice(0, i).trim(), order: s.slice(i).trim() };
}
