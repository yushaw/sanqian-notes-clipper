# Publishing Sanqian Clipper to the Chrome Web Store

This extension talks to the Sanqian Notes desktop app through a native messaging
host. The host only accepts the extension whose ID is in its `allowed_origins`.
The Web Store assigns the production ID, so there is a chicken-and-egg you have
to sequence correctly — that's the main thing this doc gets right.

## 0. Prerequisites
- A Chrome Web Store **developer account** (one-time US$5 registration).
- The built upload zip: `npm run build && npx wxt zip` →
  `output/sanqian-notes-clipper-<version>-chrome.zip`.
- A hosted **privacy policy URL** (host `PRIVACY.md`, e.g. on GitHub Pages).
- Store listing text + assets — see `docs/store-listing.md` (needs ≥1 screenshot).

## 1. Reserve the production extension ID (do this first)
The native host needs the production ID, which only exists after the item is
created in the dashboard. So:

1. Go to the Web Store **Developer Dashboard** → **Add new item** → upload the
   zip. This creates a **draft** (you do NOT have to publish yet).
2. Open the item → copy its **Item ID** (32 lowercase letters). This is the
   permanent production extension ID.

## 2. Wire the production ID into the desktop app
In the **sanqian-notes** repo:

1. Put the ID into `src/main/native-messaging.ts`:
   ```ts
   const DEFAULT_CLIPPER_EXTENSION_IDS: string[] = ['<the-item-id>']
   ```
   (or set `SANQIAN_NOTES_CLIPPER_EXTENSION_IDS` at runtime).
2. Build the native host binaries and copy them into the app's resources:
   ```sh
   cd ../sanqian-notes-clipper/native-host && ./build.sh
   cp bin/native-host-* ../../sanqian-notes/resources/native-host/
   ```
3. Build/release the desktop app. On launch it registers the native messaging
   host manifest (production only) with the production ID in `allowed_origins`.

Note: a manifest `key` does NOT pin the Web Store ID — the store assigns it — so
reserving the ID via the draft upload (step 1) is the only reliable order.

## 3. Complete the store listing
In the dashboard, fill in from `docs/store-listing.md`:
- Description, category (Productivity), single-purpose statement.
- Permission justifications (nativeMessaging, host_permissions, scripting, etc.).
- Data-use disclosures (no data collected/transmitted by the extension).
- Privacy policy URL.
- Icon (128, in the build) + screenshot(s) (1280×800 or 640×400).

## 4. Submit for review and publish
- Submit. Review for an extension using `nativeMessaging` + broad host
  permissions can take from a day to a couple of weeks; the justifications above
  are written to make the case clear.
- Once approved, publish.

## 5. Ship the desktop app update alongside
For end users it works only when **both** are in place: the published extension
AND a desktop app build that registers the host for the production ID (step 2).
Release the app update at/after the extension goes live.

## Versioning
Bump `version` in `package.json` before each store upload (the Web Store rejects
re-uploads with a non-increasing version). WXT reads the manifest version from
there.

## Dev vs. production
- **Dev** (loading unpacked): the unpacked extension gets a *different*,
  path-derived ID. Register the host for it with
  `scripts/install-host-dev.sh <unpacked-id>`. This is independent of the
  production flow above and does not require the desktop app build.
- You can keep both the dev and production IDs in `allowed_origins` so testing
  and the published extension both work.
