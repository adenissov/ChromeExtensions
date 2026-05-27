# 311 Middleware Log Search

A Chrome extension that lets City of Toronto 311 staff look up middleware-log results for any Service Request (SR) directly from a Salesforce list — without copying numbers into Kibana.

## What it does

Right-click an SR number on a Salesforce list view and the extension looks up its middleware-log result and displays it inline next to the SR number. You stay on Salesforce.

How it finds the result depends on which log the SR lives in:

- **New staging dashboard (SR > 09227488)** — the extension queries the log's search API directly from the background, so the result appears almost instantly. For a single SR it *also* opens the dashboard tab (and, on an error, the Trace page) so you can take a closer look.
- **Legacy Kibana (SR ≤ 09227488)** — the extension opens the dashboard in a background tab, finds the most recent error row, opens its Trace link, and reads the error message from the trace page.

The result text survives scrolling — if you scroll a populated SR out of view and back, it stays filled in.

## Installation

1. Open `chrome://extensions/` (or `edge://extensions/`)
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `Middleware Log Search` folder

## Usage

### Search a single SR
- Right-click an SR number link (8–9 digits) in any Salesforce list
- Choose **"Search this SR in Middleware Log"**
- The result replaces the SR-cell text — instantly for staging SRs, or after a few seconds for legacy SRs
- The dashboard tab also opens in the background, and stays open, for a closer look (errors also open the Trace page)

### Batch search from a row upward
- Right-click an SR in the SR (Request Number) column
- Choose **"Search SRs From Here Up in Middleware Log"**
- The extension searches the right-clicked SR and every SR above it (rows below it are skipped), one at a time, bottom to top
- Each cell updates as its own result comes back — no dashboard tabs are opened; results come straight from the API

You can keep working on Salesforce while batch mode runs in the background.

### What the result text means

| Display | Meaning |
|---|---|
| `09234731 - ⟳ Searching in the Middleware log...` | Search in progress |
| `09234731 - (Backend=MAXIMO, Status=200) Sent request to back-end` | Successful round-trip |
| `09234731 - (Backend=MAXIMO, Status=202) Back-end Id received: CSROWR-12` | Successful, async-acknowledged |
| `09234731 - (Backend=MAXIMO, Status=400) Error 400: BMXAA4121E - …` | Error found; full message included |
| `09234731 - No records in the Middleware log` | SR not present in any log entry |
| `09234731 - (Backend=MAXIMO, Status=400) Jaeger extraction timed out` | Result page took too long to load; try the SR again |

### Hint tips on common errors

For a few well-known patterns, the extension appends a one-line hint:

| Backend / Status | Pattern in response | Tip appended |
|---|---|---|
| `IBMS / 445` | "Neither RequestNumber nor ExternalRequestID found" | Check Integration Request for validation errors |
| `IBMS / 445` | "NO DATA FOUND for some values associated with" | Likely missing Ward number for this GeoID in the IBMS location DB |
| `MAXIMO / 500` | "object has no attribute" | Check Integration Request for validation errors |
| any | "can not find match externalRequestId for requestNumber" | Check Integration Request for validation errors |
| `4xx` | "Either the Request Number or the Customer Request Number is null" | Check Integration Request for validation errors |
| any | "No records in the Middleware log" — only when the list has a Created Date Time column and the SR is ≥ 1 hour old | Check Integration Request for validation errors |

## Two log locations — picked automatically

311 migrated the middleware logs from a legacy stack to a new dashboard partway through the SR number range. The extension routes each SR to the right place based on its number:

- **SR ≤ 09227488** → legacy Kibana at `portal.cc.toronto.ca:5601`
- **SR > 09227488** → new ByteStream O11Y dashboard at `staging.cc.toronto.ca:15601`

You don't pick — it just works.

## Trace page auto-scroll (new dashboard only)

When you (or the extension) opens a Trace link on the new staging dashboard, the trace page auto-scrolls so the data you actually want is visible without manual scrolling:
1. The **Payload** panel sits at the top of the viewport
2. Inside the panel, the `"events":` key sits at the top of the JSON code block

If the trace genuinely has no `events` element, only step 1 happens.

## Troubleshooting

| Symptom | Try |
|---|---|
| Right-click does nothing on an SR | Refresh the Salesforce page; the extension was probably reloaded |
| "Jaeger extraction timed out" repeats in batch mode | Re-run; the staging dashboard can be slow when many background tabs queue up |
| Result never appears | Confirm the SR number is 8 or 9 digits; the validator only accepts those |
| Wrong dashboard opens | The cutoff is `09227488` — anything above goes to staging, anything at-or-below goes to legacy |

## For developers

Design choices, message protocol, timeout reasoning, and known limitations are in [`ARCHITECTURE.md`](ARCHITECTURE.md).
