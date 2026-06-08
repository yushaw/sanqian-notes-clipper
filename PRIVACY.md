# Privacy Policy — Sanqian Clipper

_Last updated: 2026-06-08_

Sanqian Clipper is a browser extension that saves web pages into your own,
locally-installed Sanqian Notes desktop app. Your privacy is simple to describe
because the extension does not have any servers of its own.

## What the extension accesses

When you click the extension and choose to clip the current page, the extension
reads content from that page — its title, text, images, and any text you have
selected — and converts it to Markdown. To localize images and videos, it
downloads them from the page.

## Where that data goes

All clipped content is sent **only to the Sanqian Notes desktop app running on
your own computer**, through Chrome's Native Messaging API and a local helper
process (`com.sanqian_notes.native`) that communicates with the app over
`127.0.0.1` (your machine's loopback address).

- **Nothing is sent to the extension's developer.**
- **Nothing is sent to any third-party or external server by the extension.**
- There is no analytics, no tracking, no advertising, and no user account.

Images and videos you clip are downloaded by the extension and handed to your
local Sanqian Notes app, which stores them in its local attachment folder. Those
downloads go to the websites that host the media (the same servers your browser
already contacts to display the page).

## What the extension stores

The extension stores a single value in the browser's local extension storage:
the last notebook you clipped into, so it can default to it next time. This never
leaves your browser.

## Permissions and why they are needed

- **nativeMessaging** — to talk to your local Sanqian Notes app.
- **activeTab** + **scripting** — to read and extract the page you are actively
  clipping, only when you click the extension.
- **host permissions (all sites)** — so you can clip from any site, and so the
  extension can download a clipped page's images/videos for local storage.
- **storage** — to remember your last-used notebook.

## Data retention and deletion

The extension keeps nothing except the last-notebook preference, which you can
clear by removing the extension. Clipped notes live entirely inside your local
Sanqian Notes app and are managed there.

## Contact

Questions about this policy can be directed to the project maintainer.
