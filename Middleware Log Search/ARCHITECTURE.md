# Architecture & Design Choices

This document explains *why* the extension is structured the way it is. For user-facing documentation, see [`README.md`](README.md).

---

## 1. File map

| File | Runs on | Purpose |
|---|---|---|
| `manifest.json` | — | MV3 manifest, host permissions, content-script matchers |
| `background.js` | Service worker | Context menu, tab orchestration, queue, message routing |
| `content.js` | Salesforce (`*.salesforce.com`, `*.force.com`, `*.lightning.force.com`) | SR validation on right-click, in-place display update, table reflow |
| `error-trace-click.js` | Kibana (`portal.cc.toronto.ca`) and OSD staging (`staging.cc.toronto.ca`), restricted to ports `5601` and `15601` | Find the most-recent error row, click its Trace link |
| `jaeger-expand.js` | All URLs (filtered internally) | Extract error message from the trace page; auto-scroll |

---

## 2. Why the script split

Each content script is scoped to **one DOM contract**. Salesforce list views, the legacy Kibana UI, the new OSD dashboard, and the Jaeger / ByteStream trace pages are all on different hosts with different DOM structures and different load timings. Combining them into a single content script would force every page to load every selector and every timing strategy.

The trade-off: cross-script flow has to go through `background.js` via message passing. We accept that because content scripts on different hosts can't talk to each other directly anyway.

---

## 3. Threshold-based URL routing

311 migrated middleware logs to a new dashboard partway through the SR-number range. The extension picks the URL based on a numeric threshold:

```js
// background.js
const SR_THRESHOLD = 9227488;

function getKibanaUrl(srNumber) {
  return parseInt(srNumber, 10) > SR_THRESHOLD
    ? KIBANA_URL_TEMPLATE_STAGING.replace('NNNNNNNN', srNumber)
    : KIBANA_URL_TEMPLATE.replace('NNNNNNNN', srNumber);
}
```

**Why a numeric cutoff** instead of, say, racing both URLs and taking the first that finds the SR:
- **Cost**: opening two background tabs per SR and tearing one down would double tab-creation overhead and make batch mode unbearably slow.
- **Determinism**: the migration was a hard cutoff — an SR is on exactly one side of it.

If the cutoff shifts, only the constant changes.

---

## 4. Two Kibana DOM dialects

The legacy Kibana (port 5601) and the new OSD (port 15601) render the same logical dashboard differently. `error-trace-click.js` carries two configs and picks at runtime:

```js
const CONFIG = { tableSelector: 'table.osdDocTable', cellValueSelector: 'span[ng-non-bindable]', ... };

const STAGING_CONFIG = {
  ...CONFIG,
  tableSelector: 'table[data-test-subj="docTable"]',
  dataRowSelector: 'tbody tr',
  cellValueSelector: '.osdDocTableCell__dataField',
  statusCodeHeaderAttr: 'docTableHeader-span.attributes.http@response@status_code',
  externalRequestIdHeaderAttr: 'docTableHeader-span.attributes.http@request@header@externalrequestid'
};

const ACTIVE_CONFIG = window.location.port === '15601' ? STAGING_CONFIG : CONFIG;
```

The spread + selective overrides keep the **only** five fields that actually differ visible in one place. Everything else (header-row selector, trace-link selector, observer timeout, success codes) is shared.

The port-based switch is the simplest reliable signal — the two dashboards are on different ports of unrelated hosts.

---

## 5. Two trace-page extraction paths in one file

The legacy stack drops the user into a Jaeger UI; the new stack drops them into a ByteStream O11Y panel page. `jaeger-expand.js` runs on both and tries each in turn:

```js
const responseBody = extractResponseBody()             // Jaeger KeyValueTable
                  || extractPayloadFromByteStream();   // OSD code block
```

**ByteStream path:**
1. Concatenate the text of every `.euiCodeBlock__line` to reconstruct the JSON document
2. Parse it; walk to `_source.events[name === "response.payload"].attributes.payload`
3. If that payload is itself escaped JSON, **deep-search** for any `errorMessage` field (`findErrorMessageDeep`)

The deep search exists because real responses nest `errorMessage` differently across backends (`{errorInfo: [{errorMessage}]}`, `{error: {errorMessage}}`, plain `{errorMessage}`, etc.). A recursive walker is shorter than enumerating shapes, and it returns the first non-empty match in DFS order.

---

## 6. MutationObserver instead of timed waits

Both Kibana variants and both trace UIs are SPAs — content arrives over time, not at `DOMContentLoaded`. We use `MutationObserver` to react when the relevant elements (`AccordianLogs`, `KeyValueTable`, `euiCodeBlock__line`, the staging `<table>`) appear, with bounded fallback timeouts.

Polling on a fixed interval would either be slow (long interval) or wasteful (short interval). Fixed `setTimeout` waits would either time out before slow loads or stall on fast ones. The observer fires **exactly when the DOM changes**.

---

## 7. Timeout structure

| Timeout | Where | Reason |
|---|---|---|
| 10 s | `error-trace-click.js` `observerTimeout` | Stop watching for the Kibana table; if it never loads, give up silently |
| 10 s | `jaeger-expand.js` "no records" fallback | Only fires when `extractionAttempts > 0` or it's a Jaeger page — see §8 |
| **30 s** | `background.js` per-item batch timeout | Was 12 s. Chrome throttles background tabs, and OSD is heavy to render — 12 s timed out spuriously |
| 5 min | `jaeger-expand.js` observer disconnect | Hard cap; user might leave the tab |

**Single-SR mode has *no* per-item timeout** — opening the tab and waiting for whatever comes back. There's no queue advancing behind it, so a slow load just means a longer wait.

Batch mode needs the timeout because each item must yield to the next.

---

## 8. Trace tab vs dashboard tab — why we don't conflate

Both the new staging dashboard and its trace pages share the page title `"ByteStream O11Y"`.

**Earlier bug:** `isByteStreamPage()` returned `true` when `document.title.includes('ByteStream')`. The `jaeger-expand.js` 10-second "No records" fallback fired on the *dashboard* tab and overwrote the correct result with "No records in the Middleware log" before `error-trace-click.js` had a chance to click the Trace link.

**Current rule:** the fallback only fires when `isJaegerPage() || extractionAttempts > 0`. `extractionAttempts` is incremented only after the MutationObserver sees a real `.euiCodeBlock__line` appear — which the dashboard tab never produces. The dashboard tab now stays silent.

---

## 9. Auto-scroll on the trace page

The Payload panel on the new ByteStream trace page sits a few screens below the fold, and inside it the `"events":` key is itself buried below other JSON keys. Two-step scroll:

```js
panel.scrollIntoView({ block: 'start' });   // step 1: page scroll

// step 2: inside the panel, walk up from the "events" line to the
// nearest scrollable ancestor and adjust scrollTop directly
```

**Why not `eventsLine.scrollIntoView()` for step 2?** `scrollIntoView` scrolls *all* ancestor scrollers, including the page — that would undo step 1.

State guards (`pageScrollDone`, `innerScrollDone`) ensure each step fires at most once. A 5-second timer caps the wait for the `"events"` line, so traces that genuinely have no `events` element don't retry forever — the page scroll still stands, the inner scroll is silently skipped.

The same code path runs whether the Trace link was clicked manually or by `error-trace-click.js`, because in both cases `jaeger-expand.js` is the script on the resulting trace page.

---

## 10. Salesforce table reflow

Salesforce list-view containers set fixed heights. After the extension expands a cell with multi-line error text, the table clips bottom rows.

Workarounds tried and discarded:
- **Width manipulation** (1 px nudge): no effect
- **`window.dispatchEvent(new Event('resize'))` alone**: ignored by Salesforce's layout

What worked: add a CSS class to **five levels** of parent elements. The class overrides `height`, `max-height`, and `overflow`. Five was empirical — Salesforce's wrapper depth varies but five was always enough.

---

## 11. Manifest V3 service-worker liveness

The background script in MV3 is a non-persistent service worker. In-memory state (`lastValidSRNumber`, `sourceTabId`, queue state) is lost when the worker idles out. We accept this because:

- **Single-SR mode** tolerates a worker restart between right-click and menu-click. If it happens, the right-click's `updateMenuState` message gets a "port closed" failure (logged but harmless) and the user re-issues the action.
- **Batch mode** keeps the worker alive by having continuous activity (open tab, listen for message, open next tab). The worker doesn't idle out mid-queue.

If batch reliability ever becomes a problem, the next step is persisting queue state to `chrome.storage.session`.

---

## 12. Known limitations

- **Threshold-based routing** assumes a sharp cutoff. If logs are ever dual-written across both stacks during a transition window, an SR could exist on either side; the extension only checks one.
- **Auto-scroll** is implemented for the new ByteStream layout only. The Jaeger UI has its own existing accordion-expand behavior in the same file.
- **"Jaeger extraction timed out"** can still happen on very slow staging loads (>30 s). Re-running the SR typically succeeds.
- **`findErrorMessageDeep`** returns the first match in DFS order. Backends with multiple errors only get the first one reported.
- **Service-worker restart** during single-SR mode produces a "message port closed" warning in the Salesforce console; this is informational, not an error.
