# 311 Middleware Log Search

A Chrome extension that lets City of Toronto 311 staff look up middleware-log results for any Service Request (SR) directly from a Salesforce list — without copying numbers into Kibana.

## What it does

Right-click an SR number on a Salesforce list view and the extension looks up its middleware-log result and displays it inline next to the SR number. You stay on Salesforce.

The extension queries the log's search API directly from the background, so the result appears almost instantly. For a single SR it *also* opens the dashboard tab (and, on an error, the Trace page) so you can take a closer look.

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
- The result replaces the SR-cell text — almost instantly, straight from the log search API
- The dashboard tab also opens in the background, and stays open, for a closer look (errors also open the Trace page)

### Batch search the whole column
- Right-click any SR in the SR (Request Number) column
- Choose **"Search All SRs in Middleware Log"**
- The extension searches every SR in the column, one at a time, bottom to top — the row you right-clicked doesn't matter
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

### Hint tips on common errors

For a few well-known patterns, the extension appends a one-line hint:

| Backend / Status | Pattern in response | Tip appended |
|---|---|---|
| `IBMS / 445` | "Neither RequestNumber nor ExternalRequestID found" | Check Integration Request for validation errors |
| `IBMS / 445` | "NO DATA FOUND for some values associated with" | Likely missing Ward number for this GeoID in the IBMS location DB. Open a ticket in Jira IBMS Intake |
| `MAXIMO / 500` | "object has no attribute" | Check Integration Request for validation errors |
| any | "can not find match externalRequestId for requestNumber" | Check Integration Request for validation errors |
| `4xx` | "Either the Request Number or the Customer Request Number is null" | Check Integration Request for validation errors |
| any | "No records in the Middleware log" — only when the list has a Created Date Time column and the SR is ≥ 1 hour old | Check Integration Request for validation errors |

## Log location

All SRs are searched in the ByteStream O11Y dashboard at `staging.cc.toronto.ca:15601`. 311 previously ran a legacy Kibana stack (`portal.cc.toronto.ca:5601`) for older SRs; that stack was retired and the extension no longer searches it.

## Trace page auto-scroll

When you (or the extension) opens a Trace link on the new staging dashboard, the trace page auto-scrolls so the data you actually want is visible without manual scrolling:
1. The **Payload** panel sits at the top of the viewport
2. Inside the panel, the `"events":` key sits at the top of the JSON code block

If the trace genuinely has no `events` element, only step 1 happens.

## Troubleshooting

| Symptom | Try |
|---|---|
| Right-click does nothing on an SR | Refresh the Salesforce page; the extension was probably reloaded |
| Result never appears | Confirm the SR number is 8 or 9 digits; the validator only accepts those |
| "Middleware log search failed" | You may be logged out of the dashboard — open `staging.cc.toronto.ca:15601` and sign in, then retry |

## For developers

Design choices, message protocol, timeout reasoning, and known limitations are in [`ARCHITECTURE.md`](ARCHITECTURE.md).
