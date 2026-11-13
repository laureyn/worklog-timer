# Worklog Timer (unofficial)

Worklog Timer is a Chrome and Brave extension (Manifest V3) that ports the Windows desktop app [Jira StopWatch](https://github.com/jirastopwatch/jirastopwatch), written by Carsten Gehling, Dan Tulloh, Y. Meyer-Norwood and contributors. It is not affiliated with or endorsed by Atlassian or the original authors.

Track time on Jira issues, log work, and search the tasks assigned to you, from the toolbar or from a side panel that stays open.

## Install (unpacked)
1. Unzip this folder somewhere permanent.
2. Open `chrome://extensions` (or `brave://extensions`) and turn on Developer mode.
3. Click Load unpacked and pick the folder that contains `manifest.json`.
4. Pin the extension. The settings page opens automatically on first install:
   - Jira URL: for example `https://your-company.atlassian.net`. Click Save and allow access to the site.
   - Jira Cloud: your email plus an API token from https://id.atlassian.com/manage-profile/security/api-tokens
   - Server / Data Center: a personal access token
   - Browser login: uses your logged-in Jira session cookies, so no token is needed.

## Use
- Timers tab: type or paste an issue key or URL, then press ▶ to start. Click the clock to edit the time (`1h 30m`, `1:30`, `+15m`, `-5m`).
  - ⇪ log work · ↺ reset · ↗ open in Jira · ✕ remove
- My tasks tab: your unresolved assigned issues. Search by text or key, or switch to *All issues* or one of your favourite filters.
  - ▶ start a timer · ＋ add without starting · ⇪ log time directly without a timer
- On a Jira issue page, the popup offers to track or log that issue.
- Side panel (◧ button): keeps the timer open next to any page.
- Shortcuts: `Alt+Shift+J` opens the popup, and `Alt+Shift+K` starts or pauses your most recent timer.
- Toolbar badge: shows the running time.

Timers are stored as timestamps, so they keep counting when the popup is closed.

If the browser is closed or the computer sleeps, the extension records a heartbeat every 30 seconds. When it finds a gap of more than 5 minutes (browser quit, shutdown, sleep, or crash), it pauses running timers as of the last heartbeat and tells you in the popup. It also pauses at once when the last browser window closes while the browser keeps running in the background. You can turn this off in Settings.

## Mapping from the desktop app
| Desktop (C#) | Extension |
|---|---|
| `WatchTimer` | `src/store.js`: elapsed time is calculated from timestamps, plus the same "initial start time" rule for worklogs |
| `JiraClient` / `JiraApiRequestFactory` | `src/jira.js` (fetch) |
| `JiraTimeHelpers` / `JiraKeyHelpers` | `src/time.js` |
| `IssueControl`, `MainForm` | `popup.js` (Timers tab) |
| Filter dropdown | My tasks tab: assigned, all, or favourite filters, plus text search |
| `WorklogForm` | Log work dialog: time, started, comment, estimate (auto, leave, set, or reduce), "Save comment" |
| `EditTimeForm` | Edit time dialog |
| Settings: multiple timers, project name, post comment, start transitions | Settings page (same options) |
| Pause on session lock | `chrome.idle` "locked" state (pause, or pause and resume); also pauses on browser close or sleep through a heartbeat |
| Always on top / tray | Side panel, badge, keyboard shortcuts |
| DPAPI-encrypted token | Stored in `chrome.storage.local`, local to this browser profile and not synced |

### Updated for current Jira
- Search uses `/rest/api/2/search/jql`, because Jira Cloud removed `/search`. Server and Data Center fall back to `/search`.
- The connection is checked with `/myself`, since `/rest/auth/1/session` doesn't exist on Cloud.
- A `declarativeNetRequest` session rule removes the `Origin` header from this extension's own requests to your Jira host. Without it, Jira rejects POSTs with "XSRF check failed".
- In a duration, `d` means one Jira working day (8h by default), not 24 hours.

Not ported: the auto-update check and file logging. The browser handles updates, and you can use DevTools for debugging.

## License and attribution
This project is licensed under the Apache License, Version 2.0 (see [LICENSE](LICENSE)). It is a modified version of Jira StopWatch, Copyright 2025 Carsten Gehling, Dan Tulloh, Y. Meyer-Norwood, et al. Source files marked "Portions derived from Jira StopWatch" were changed from the original C# code.

The original project is charityware. If you find this useful, please consider donating to the charity named at https://github.com/jirastopwatch.

Privacy: see [PRIVACY.md](PRIVACY.md). Data stays in your browser and is sent only to the Jira site you configure.
