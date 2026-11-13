# Privacy policy: Worklog Timer

Last updated: 12 November 2026

Worklog Timer has no server of its own. It collects no personal data, sells none and shares none. It includes no analytics, advertising or tracking.

## What is stored, and where
Everything is kept locally in your browser profile, in the extension's own storage (`chrome.storage.local`):
- Your settings: the Jira site address and, if you chose token sign-in, your email address and API token.
- Your timers: issue keys, summaries, elapsed time, and any comment you saved.
- A cached list of your assigned issues, used for autocomplete.
- A timestamp that tells the extension when the browser was last running.

Nothing is synced to Google or any other service. Uninstalling the extension deletes this data.

## Where data is sent
Requests go only to the Jira site you enter in Settings. They use your credentials (an API token, or your existing Jira login) to read issues you can see, and to post the worklogs, comments and status changes you start. The extension never contacts any other server.

With "Use my existing browser login", the extension asks the browser to attach your Jira session cookies to requests for your Jira site. The extension cannot read those cookies and does not store them.

## Permissions
The extension requests the permissions below. Each is used only for the purpose listed.
- Access to your Jira site, requested when you save the URL. It makes the requests described above. It also lets the extension read the address of the tab you have open on that Jira site, so it can show the issue you are viewing. It cannot read addresses on other sites.
- Storage, to keep your settings and timers on your computer.
- Idle state, to pause timers when the screen locks, and when the browser was closed or the computer slept.
- Alarms, to refresh the toolbar badge and record the heartbeat.
- Side panel, to show the panel with the issue open in your current tab.
- Notifications, to confirm a timer started or stopped from a keyboard shortcut.
- Modifying request headers for your Jira site. This removes the browser's Origin header from the extension's own requests to that site, because Jira otherwise rejects them as cross-site. It does not affect other websites.

## Contact
For questions about this policy or your data, email laureyn.dev@gmail.com or open an issue at https://github.com/laureyn/worklog-timer/issues
