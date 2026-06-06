# Architecture & Design Choices

This document explains *why* the extension is structured the way it is. For user-facing documentation, see [`README.md`](README.md).

---

## 1. File map

| File | Runs on | Purpose |
|---|---|---|
| `manifest.json` | — | MV3 manifest, host permissions, content-script matchers |
| `background.js` | Service worker | Context menu, tab orchestration, queue, API/tab mode routing, message routing |
| `osd-api.js` | Service worker (`importScripts`) | Query the staging OSD search API directly; replicate the table/trace result logic server-side |
| `row-classify.js` | Service worker (`importScripts`) **and** the Kibana/OSD pages (content script) | Pure `classifyStatusRows(rows)` — the single shared "which row wins, success or error?" decision (§4) |
| `content.js` | Salesforce (`*.salesforce.com`, `*.force.com`, `*.lightning.force.com`) | SR validation on right-click, in-place display update + persistence across row re-render, table reflow |
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

**Row selection is *not* in this file.** Once `error-trace-click.js` has scraped the rows, the "which row wins — success or error?" decision is delegated to `classifyStatusRows` in `row-classify.js` (§4a), the same function the API path uses. This file only handles DOM scraping and the resulting click; it normalizes each scraped row to the shared shape before calling.

---

## 4a. Shared row classification (`row-classify.js`)

The exact same rule — *given all log rows for an SR, decide whether it succeeded and which row to report* — is needed by two callers that get their rows from completely different places:

- `error-trace-click.js` scrapes rows out of the dashboard **DOM**;
- `osd-api.js` (`osdLookupSR`) gets rows as **JSON hits** from the search API (§13).

To stop the rule from drifting between them, it lives once as the pure function `classifyStatusRows(rows)` in `row-classify.js`, loaded into **both** contexts (content-script entry in the manifest **and** `importScripts` in the worker — listed *before* the files that call it).

**Contract.** Each caller normalizes its rows, newest-first, to `{ statusCode, backend, extReqId, trace, ref }` (`ref` is the original DOM node or hit, so the caller can act on the chosen row). `classifyStatusRows` returns one of:

```
{ kind: 'noRecords' }
{ kind: 'success', statusCode, row }   // 200 or 202
{ kind: 'error',   statusCode, row }
```

Rule: take the **max status code** across rows; `200`/`202` → success (a `202` picks the oldest `202`; a `200` picks the oldest row with a non-empty backend); otherwise → error (the oldest non-success row). The two callers then *act* differently on the result — `error-trace-click.js` clicks the chosen error row's Trace cell, `osd-api.js` fetches that row's trace over the API — but the **decision** is identical.

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

In `jaeger-expand.js` these and the smaller delays are not scattered literals — they live in one named `TIMERS` block at the top of the file (`OBSERVER_DISCONNECT_MS`, `INNER_SCROLL_CAP_MS`, `EXTRACT_AFTER_ACCORDION_MS`, etc.). Tune timing there, not inline.

**Single-SR mode has *no* per-item timeout** — opening the tab and waiting for whatever comes back. There's no queue advancing behind it, so a slow load just means a longer wait.

Batch mode (legacy tab flow) needs the timeout because each item must yield to the next.

**API mode (§13) has no tab timeout at all.** A staging single-SR still opens the dashboard tab for a closer look, but its result comes from the API, so the trace-scrape timeout is *deliberately skipped* (`apiMode` flag) — otherwise it would overwrite the API text with "timed out" and close the tab. The API `fetch` has its own implicit network timeout.

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

The background script in MV3 is a non-persistent service worker. In-memory state (`lastRightClick`, `activeSingleSR`, queue state) is lost when the worker idles out. We accept this because:

- **Single-SR mode** tolerates a worker restart between right-click and menu-click. If it happens, the right-click's `updateMenuState` message gets a "port closed" failure (logged but harmless) and the user re-issues the action.
- **Batch mode** keeps the worker alive by having continuous activity (open tab, listen for message, open next tab). The worker doesn't idle out mid-queue.

If batch reliability ever becomes a problem, the next step is persisting queue state to `chrome.storage.session`.

API-mode batch (§13) is a single `async` function awaiting sequential `fetch`es; the in-flight `await` keeps the worker alive, and a generation token (`apiBatchId`) cancels it if a new search starts.

---

## 12. Known limitations

- **Threshold-based routing** assumes a sharp cutoff. If logs are ever dual-written across both stacks during a transition window, an SR could exist on either side; the extension only checks one.
- **Auto-scroll** is implemented for the new ByteStream layout only. The Jaeger UI has its own existing accordion-expand behavior in the same file.
- **"Jaeger extraction timed out"** can still happen on very slow legacy single-SR loads (>30 s). Re-running the SR typically succeeds. Staging SRs use the API (§13) and don't hit this.
- **`findErrorMessageDeep`** returns the first match in DFS order. Backends with multiple errors only get the first one reported.
- **Service-worker restart** during single-SR mode produces a "message port closed" warning in the Salesforce console; this is informational, not an error.
- **API batch mode (§13) is staging-only and not threshold-gated.** It runs *every* SR through the staging API. This is safe today because legacy SRs (≤ threshold) never appear in a batch — they predate the dashboard. If a legacy SR ever ended up in a batch, it would wrongly come back "No records" instead of falling back to the legacy tab flow.
- **The far-left grid row-number gutter doesn't height-sync with expanded cells.** The Salesforce report renders the row-number gutter as a *separate* frozen column. When an expanded Request-Number cell grows tall (§14), its data row grows but the gutter's matching cell does not, so the row numbers drift out of alignment. The gutter is not reachable by the row-level CSS in §10/§14. Open; not yet fixed (candidate fixes: hide the gutter, or target it directly once its DOM is known).

---

## 13. Direct OSD API query (staging fast-path)

The staging dashboard is a heavy SPA. Opening it in a *background* tab is slow because Chrome throttles background tabs (timer clamping, suspended `requestAnimationFrame`/painting), so the table can take many seconds to render before `error-trace-click.js` can scrape it. Switching focus to the tab speeds it up — which is exactly the symptom that motivated this path.

Instead, `osd-api.js` calls the dashboard's own internal search endpoint directly from the service worker:

```js
fetch('https://staging.cc.toronto.ca:15601/internal/search/opensearch', {
  method: 'POST', credentials: 'include',         // reuse the logged-in session cookie
  headers: { 'osd-xsrf': 'osd-fetch', 'osd-version': '2.19.0', ... },
  body: JSON.stringify(buildSearchBody(srNumber, from, to))
});
```

**Why this works without an API key:** the user is already logged into the dashboard, so the session cookie authenticates the request. `host_permissions: ["<all_urls>"]` lets the service worker send it cross-origin with credentials. No new permission, no key, no token handling.

**Faithful replication, not a new query.** The request body (`buildSearchBody`) and the painless `script_fields` (Trace, HttpStatusCode, Backend, External/Request IDs) are copied **verbatim** from a real dashboard search captured in DevTools, so the API returns the exact column values the scraped table used to show. `osdLookupSR` normalizes the hits and runs them through the **shared** `classifyStatusRows` (§4a) — the same decision `error-trace-click.js` uses — then, on an error verdict, fetches that row's trace and pulls the `response.payload` error message via the same `findErrorMessageDeep` walker as `jaeger-expand.js` (§5).

**Where it's used (`useApi = srNumber > SR_THRESHOLD`):**
- **Batch** — fully API; no tabs opened. A single `runApiBatch` awaits each SR sequentially.
- **Single SR** — API populates the cell instantly *and* the dashboard tab still opens (kept open for a closer look; errors also open the Trace page). The two are independent: the API write is the fast answer, the tab is for the human.
- **Legacy SRs** — no API exists for the legacy stack; they stay entirely on the tab-scrape flow.

**Trade-off / fragility:** the endpoint and body are undocumented and version-specific (`osd-version: 2.19.0`). An OSD upgrade can change either. The tab-scrape flow remains as the legacy path and the conceptual fallback. If the API shape breaks, the fix is to re-capture a search request and update `buildSearchBody`/`SCRIPT_FIELDS`.

---

## 14. Result persistence across Salesforce row re-render

Salesforce Lightning **virtualizes list rows**: a row scrolled out of the viewport is recycled/re-rendered, which wipes any text we injected into its cell (and the `data-mwlog-id` marker). This was latent in the old tab-scrape flow — results trickled in seconds later, after the list had settled, so nothing overwrote them. The API fast-path made it visible: results land instantly, into a still-rendering list, and vanish on the next scroll.

`content.js` fixes this independently of how the result was obtained:

1. Every `updateSRDisplay` result is stored in a `Map` keyed by **SR number** (not by the fragile `data-mwlog-id`, which the recycle wipes).
2. A `MutationObserver` watches `document.body` for re-renders. On a mutation it re-paints any on-screen SR link whose text doesn't match its stored result — identifying rows by the **leading SR token** in the link text, which is stable whether the node is fresh (`09396684`) or already painted (`09396684 - 200 OK`).

**Guards that keep it from fighting Salesforce** (each one was added to kill a specific flicker/miss observed in testing):
- The re-paint is debounced to fire only after the DOM has been **quiet for 200 ms** (`REAPPLY_QUIET_MS`), not per animation frame, and there is **no `scroll` listener**. An earlier version re-painted during active scrolling, which at the very bottom of a long list fed a loop (scroll nudges the pinned bottom → re-paint grows a cell → nudges again) and flickered. Re-painting only at rest breaks the loop.
- The observer watches `{ childList, subtree, characterData }`. **`characterData` is required**: Salesforce sometimes recycles a row by rewriting the existing text node rather than replacing the node, which a `childList`-only observer misses — that was the cause of a few rows at the top of the list scrolling back into view still un-appended.
- `reapplyStoredResults` **disconnects the observer while it writes**, then `takeRecords()` + re-observes, so its own paints can't re-trigger it.
- The `resize` reflow (§10) is dispatched **only on first paint**, not on re-paints, and is itself coalesced (a `pendingResizeReflow` flag + one rAF) — the resize event nudges Salesforce to re-render, which would otherwise re-trigger the observer.

Together with the text-equality skip in the scan (don't rewrite a link that's already correct), the loop settles after one quiet re-paint.

**Cell height is capped (§10 CSS).** A tall result (multi-line error payloads ran ~25 lines) is clamped to ~10 lines with an internal scrollbar (`.mwlog-expanded-cell a { max-height: 14em; overflow-y: auto }`). This is not only cosmetic: uncapped, a very tall cell pushed earlier rows off the top of the viewport where they never got appended, and variable row heights worsened the scroll feedback loop above. The unclamp rules and the cap live on different specificities on purpose — the `*` rule defeats Salesforce's own line-clamp (it needs all of `overflow:visible; height:auto; max-height:none`, or Salesforce's wrapper squashes the cell back to one line), while the higher-specificity `a` rule re-imposes our 10-line cap.

---

## 15. Cell-paint routing (`background.js`)

Every visible result in a Salesforce cell is written by exactly one function:

```js
paintCell(tabId, elementId, srNumber, text, isSearching = false)
```

`paintCell` is the **single choke point** — it builds the `updateSRDisplay` message, sends it to the Salesforce tab, and logs on skip/failure. The three "⟳ Searching…" spinners and every final verdict all go through it (with `isSearching` as an explicit boolean, *not* by sniffing the text for the word "Searching"). Centralizing it means there's one place to change the message shape, and one place that logs why a paint didn't land.

**Routing a reply to the right cell.** Tab-scrape replies (`statusResult`, `noRecordsFound`, `responseBodyExtracted`) arrive from a Kibana/Jaeger tab and must be mapped back to the cell that asked for them. `resolveReplyTarget(senderTabId)` is the one resolver: it matches the sending tab against `activeSingleSR`'s kibana/jaeger tab ids or the current queue item, and returns `{ tabId, elementId, srNumber }` — or `null`, in which case the reply is **dropped and logged** rather than painted into whatever cell happens to be current. This replaced a set of loose globals (`lastValidSRNumber`/`sourceTabId`/`elementId`) that any handler could overwrite; right-click context now lives in one `lastRightClick = { tabId, srNumber, elementId, allItems }` object, batch source in `batchSourceTabId`.

**`resultDelivered` — don't cancel a finished search.** In the API fast-path a staging single-SR fills its cell instantly but keeps its dashboard/Trace tabs open (§13). `activeSingleSR` therefore lingers after the answer is already shown. Without a guard, the *next* search's `cancelSingleSR()` would paint "Search cancelled" over the completed text. `activeSingleSR.resultDelivered` is set `true` once the API paints the final result, and `cancelSingleSR()` only writes "Search cancelled" when `!resultDelivered` — a finished search is left intact; only a genuinely in-flight one is cancellable.
