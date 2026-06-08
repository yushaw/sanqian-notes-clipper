# Chrome Web Store listing — Sanqian Clipper

Copy/paste material for the Web Store dashboard. (The store listing is filled in
the dashboard, not in the extension itself; you can add a Chinese listing too.)

## Name
Sanqian Clipper

## Summary (≤132 chars)
Clip web pages, articles, selections, and arXiv papers straight into your local Sanqian Notes app.

## Category
Productivity

## Single purpose (required)
Save web content (full articles, selections, or arXiv papers) into the user's
locally-installed Sanqian Notes desktop app as Markdown notes.

## Detailed description
Sanqian Clipper sends what you're reading into your own Sanqian Notes app — no
cloud, no account. Everything goes to the app running on your computer.

- Article mode extracts the main content of a page (via Defuddle) into clean
  Markdown, with the title, author, source URL, and date.
- Selection mode clips just what you've highlighted.
- arXiv pages are imported as structured papers (abstract, sections, figures).
- Images and videos are downloaded and stored locally in your notes, so clips
  don't break when the original page changes.
- Pick which notebook to save into, or drop it in your Inbox.

Requires the Sanqian Notes desktop app (it provides the local connection the
extension talks to). The interface is available in English and Chinese.

## Permission justifications (for review)
- **nativeMessaging**: required to send clipped content to the local Sanqian
  Notes desktop app via its native messaging host.
- **activeTab + scripting**: the extension injects an extraction script into the
  current tab only when the user clicks "Clip", to read the page's content.
- **host_permissions `<all_urls>`**: users clip from arbitrary websites, and the
  extension downloads a clipped page's images/videos so they can be stored
  locally; both require access to any site.
- **storage**: remembers the user's last-selected notebook.

## Data use disclosures
- Does the extension collect user data? The extension does not collect or
  transmit any data to the developer or third parties. Clipped content is sent
  only to the user's own local desktop app.
- Personally identifiable information: none collected.
- Sells/transfers data: no.
- Uses data for purposes unrelated to single purpose: no.

## Privacy policy URL
https://github.com/yushaw/sanqian-notes-clipper/blob/main/PRIVACY.md

## Support URL
https://github.com/yushaw/sanqian-notes-clipper/issues

## Assets needed (provide before submitting)
- Icon 128×128 (already in the build: public/icon/128.png).
- At least one screenshot, 1280×800 or 640×400 (e.g. the popup over a page being
  clipped, and a clipped note open in Sanqian Notes).
- Optional small promo tile 440×280.
