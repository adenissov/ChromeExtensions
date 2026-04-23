# Context menu title: `.` → `_`

User asked to change the right-click menu label from **"SR Search in.Integration Requests"** to **"SR Search in_Integration Requests"**.

## Why the separator exists
Chrome sorts `chrome.contextMenus` items alphabetically (case-insensitive). Both `.` and `_` sort before letters `A`–`Z`/`a`–`z`, so they pull the item toward the top of the right-click menu regardless of what other extensions are installed. Switching from period to underscore preserves the sort advantage with a cleaner visual separator.

## Files changed
- `background.js:13` — `chrome.contextMenus.create` `title` field.
- `README.md:28` — "How to Use" step 2 label.
- `README.md:338` — Version 1.2 history entry: label + rationale reworded ("period" → "underscore").
- `ARCHITECTURE.md:64` — Permissions table description.
- `ARCHITECTURE.md:410–420` — "Key Technical Decisions" section 11 heading, prose, and embedded code example all updated.

## Verification
Grep across `*.md` confirmed no remaining references to the old `"SR Search in.Integration Requests"` form. The only remaining "period" hit is unrelated (cooldown period wording in troubleshooting table).

## What the user needs to do
Reload the unpacked extension in `chrome://extensions/` — the new title only takes effect on the next install/reload because `chrome.contextMenus.create` runs in `onInstalled`.

## Extension name untouched
The `manifest.json` `name` field (`"SR Search in Integration Requests"`, plain space) is deliberately unchanged — the sort trick is only needed where multiple extensions compete for placement (context menu), not in the Extension Manager or icon tooltip.
