# Chrome Web Store listing (draft)

**Name:** Worklog Timer

**Summary (132 characters max):**
Track time on Jira issues, log work and find your assigned tasks from the toolbar or side panel.

**Description:**
Start a timer on a Jira issue and log the work when you finish. Worklog Timer works with Jira Cloud (email and API token), Jira Server or Data Center (personal access token), or your existing Jira login in the browser.

- Timers: type or paste an issue key or link, then click the clock to adjust the time (1h 30m, 1:15, +15m).
- Log work: enter the time spent, start time, comment and remaining estimate, as in the original desktop app.
- My tasks: search your assigned issues, all issues, or a favourite filter.
- Side panel: keep the timer open while you browse. The panel follows the issue you have open.
- Automatic pause: timers pause when you lock the screen, close the browser, or the computer sleeps.
- Keyboard shortcuts and a toolbar badge that shows the running time.

Your data stays in your browser. The extension talks only to your Jira site and has no analytics or ads.

This is an unofficial extension, not affiliated with or endorsed by Atlassian. It is a browser port of Jira StopWatch by Carsten Gehling and contributors, released under the Apache License 2.0. If you find it useful, please consider donating to the charity named on the original project's GitHub page: https://github.com/jirastopwatch

**Category:** Productivity
**Language:** English

**Permission justifications (for the review form):**
- storage: saves settings and timers locally.
- alarms: refreshes the badge and the heartbeat.
- idle: pauses timers on screen lock or sleep.
- sidePanel: optional panel that shows the issue open in the current tab.
- notifications: confirms timer changes made with keyboard shortcuts.
- declarativeNetRequestWithHostAccess: sets the Origin header only on the extension's own requests to the user's Jira site, to the site itself. Jira requires this for API writes from an extension. Scoped to that one site, so no other sites are affected.
- optional host permissions: requested per Jira site the user enters, at setup time. Also lets the extension read the address of the current tab on that site, to find the issue key. Nothing is sent elsewhere.

**Privacy policy URL:** https://github.com/laureyn/worklog-timer/blob/main/PRIVACY.md

**Support contact:** laureyn.dev@gmail.com
