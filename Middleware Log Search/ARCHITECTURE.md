# Architecture & Design Choices

This document explains *why* the extension is structured the way it is. For user-facing documentation, see [`README.md`](README.md).

---

## 1. File map

| File | Runs on | Purpose |
|---|---|---|
| `manifest.json` | — | MV3 manifest, host permissions, content-script matchers |
| `background.js` | Service worker | Context menu, API batch + single-SR orchestration, dashboard tab, message routing |
| `osd-api.js` | Service worker (`importScripts`) | Query the staging OSD search API directly; replicate the table/trace result logic server-side |
| `row-classify.js` | Service worker (`importScripts`) **and** the OSD dashboard pages (content script) | Pure `classifyStatusRows(rows)` — the single shared "which row wins, success or error?" decision (§4a) |
| `content.js` | Salesforce (`*.salesforce.com`, `*.force.com`, `*.lightning.force.com`) | SR validation on right-click, in-place display update + persistence across row re-render, table reflow |
| `error-trace-click.js` | OSD staging dashboard (`staging.cc.toronto.ca`), restricted to port `15601` | Find the most-recent error row, click its Trace link |
| `jaeger-expand.js` | All URLs (filtered internally) | Extract error message from the trace page; auto-scroll. Still handles the legacy Jaeger UI as well as the ByteStream page, kept for manually opened old traces |

---

## 2. Why the script split

Each content script is scoped to **one DOM contract**. Salesforce list views, the OSD dashboard, and the ByteStream (and legacy Jaeger) trace pages are on different hosts with different DOM structures and different load timings. Combining them into a single content script would force every page to load every selector and every timing strategy.

The trade-off: cross-script flow has to go through `background.js` via message passing. We accept that because content scripts on different hosts can't talk to each other directly anyway.

---

## 3. One dashboard (legacy stack retired)

311 once split middleware logs across a legacy Kibana stack (`portal.cc.toronto.ca:5601`) and a newer OSD dashboard (`staging.cc.toronto.ca:15601`), routed by a numeric `SR_THRESHOLD`. The legacy stack has since been retired — old SRs are no longer searched — so the threshold, the second URL template, and the dual routing are **gone**. Every SR now resolves to the single staging dashboard:

```js
// background.js
function getDashboardUrl(srNumber) {
  return DASHBOARD_URL_TEMPLATE.replace('NNNNNNNN', srNumber);
}
```

The only legacy code deliberately kept is `jaeger-expand.js`'s Jaeger trace-page expander (§5), in case someone opens an old Jaeger trace by hand.

---

## 4. One dashboard DOM dialect

`error-trace-click.js` carries a single `CONFIG` of selectors for the OSD dashboard:

```js
const CONFIG = {
  tableSelector: 'table[data-test-subj="docTable"]',
  dataRowSelector: 'tbody tr',
  cellValueSelector: '.osdDocTableCell__dataField',
  statusCodeHeaderAttr: 'docTableHeader-span.attributes.http@response@status_code',
  externalRequestIdHeaderAttr: 'docTableHeader-span.attributes.http@request@header@externalrequestid',
  ...
};
```

The script is gated to port `15601`. The earlier version carried a second `CONFIG`/`STAGING_CONFIG` pair switched on `window.location.port` to also handle the legacy Kibana DOM at port 5601; that was removed with the legacy stack (§3).

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

The current stack drops the user into a ByteStream O11Y panel page; the retired legacy stack used a Jaeger UI. `jaeger-expand.js` still handles **both** and tries each in turn — the ByteStream path is the live one, the Jaeger path is kept for an old trace opened by hand (§3):

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

The OSD dashboard and the trace UIs are SPAs — content arrives over time, not at `DOMContentLoaded`. We use `MutationObserver` to react when the relevant elements (`AccordianLogs`, `KeyValueTable`, `euiCodeBlock__line`, the dashboard `<table>`) appear, with bounded fallback timeouts.

Polling on a fixed interval would either be slow (long interval) or wasteful (short interval). Fixed `setTimeout` waits would either time out before slow loads or stall on fast ones. The observer fires **exactly when the DOM changes**.

---

## 7. Timeout structure

| Timeout | Where | Reason |
|---|---|---|
| 25 s | `error-trace-click.js` `observerTimeout` | Stop watching for the dashboard table; if it never loads, give up silently |
| 10 s | `jaeger-expand.js` "no records" fallback | Only fires when `extractionAttempts > 0` or it's a Jaeger page — see §8 |
| 5 min | `jaeger-expand.js` observer disconnect | Hard cap; user might leave the tab |

In `jaeger-expand.js` these and the smaller delays are not scattered literals — they live in one named `TIMERS` block at the top of the file (`OBSERVER_DISCONNECT_MS`, `INNER_SCROLL_CAP_MS`, `EXTRACT_AFTER_ACCORDION_MS`, etc.). Tune timing there, not inline.

**There is no per-search tab timeout in `background.js`.** Every search now answers from the API (§13): the batch (`runApiBatch`) awaits each `fetch` sequentially, and a single-SR fills its cell from the API while a dashboard tab opens alongside purely for the human. The API `fetch` has its own implicit network timeout. The dashboard tab's own scrape can't overwrite a delivered API result (`resultDelivered`, §15), so it needs no extension-side timeout. (The earlier tab-scrape flow had a 30 s per-item batch timeout and a single-SR trace timeout; both were removed with the legacy stack.)

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

The background script in MV3 is a non-persistent service worker. In-memory state (`lastRightClick`, `activeSingleSR`, batch state) is lost when the worker idles out. We accept this because:

- **Single-SR mode** tolerates a worker restart between right-click and menu-click. If it happens, the right-click's `updateMenuState` message gets a "port closed" failure (logged but harmless) and the user re-issues the action.
- **Batch mode** (§13) is a single `async` function (`runApiBatch`) awaiting sequential `fetch`es; the in-flight `await` keeps the worker alive, and a generation token (`apiBatchId`) cancels it if a new search starts.

If batch reliability ever becomes a problem, the next step is persisting batch state to `chrome.storage.session`.

---

## 12. Known limitations

- **Old SRs return "No records."** The legacy log stack was retired (§3); every search now hits only the staging dashboard, so an SR that predates it simply comes back "No records in the Middleware log."
- **Auto-scroll** is implemented for the ByteStream layout only. The legacy Jaeger UI has its own existing accordion-expand behavior in the same file (kept for manually opened old traces).
- **`findErrorMessageDeep`** returns the first match in DFS order. Backends with multiple errors only get the first one reported.
- **Service-worker restart** during single-SR mode produces a "message port closed" warning in the Salesforce console; this is informational, not an error.
- **The far-left grid row-number gutter doesn't height-sync with expanded cells.** The Salesforce report renders the row-number gutter as a *separate* frozen column. When an expanded Request-Number cell grows tall (§14), its data row grows but the gutter's matching cell does not, so the row numbers drift out of alignment. The gutter is not reachable by the row-level CSS in §10/§14. Open; not yet fixed (candidate fixes: hide the gutter, or target it directly once its DOM is known).

---

## 13. Direct OSD API query (the primary path)

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

**Where it's used (every SR — there is no longer a threshold):**
- **Batch** — fully API; no tabs opened. A single `runApiBatch` awaits each SR sequentially.
- **Single SR** — API populates the cell instantly *and* the dashboard tab still opens (kept open for a closer look; errors also open the Trace page). The two are independent: the API write is the fast answer, the tab is for the human. If the API `fetch` fails, the dashboard tab's scrape paints the cell as the fallback (`resultDelivered` stays false — §15).

**Trade-off / fragility:** the endpoint and body are undocumented and version-specific (`osd-version: 2.19.0`). An OSD upgrade can change either. The dashboard tab that opens for single-SR is the conceptual fallback (its `error-trace-click.js` scrape still runs). If the API shape breaks, the fix is to re-capture a search request and update `buildSearchBody`/`SCRIPT_FIELDS`.

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

**Routing a reply to the right cell.** Tab-scrape replies (`statusResult`, `noRecordsFound`, `responseBodyExtracted`) arrive from the single-SR dashboard/trace tab and must be mapped back to the cell that asked for them. `resolveReplyTarget(senderTabId)` is the one resolver: it matches the sending tab against `activeSingleSR`'s dashboard/trace tab ids (`kibanaTabId`/`jaegerTabId`) and returns `{ tabId, elementId, srNumber }` — or `null`, in which case the reply is **dropped and logged** rather than painted into whatever cell happens to be current. (Batch mode is API-only and opens no tabs, so it has no reply to route.) This replaced a set of loose globals (`lastValidSRNumber`/`sourceTabId`/`elementId`) that any handler could overwrite; right-click context now lives in one `lastRightClick = { tabId, srNumber, elementId, allItems }` object, batch source in `batchSourceTabId`.

**`resultDelivered` — don't overwrite or cancel a finished search.** In the API fast-path a staging single-SR fills its cell instantly but keeps its dashboard/Trace tabs open (§13). `activeSingleSR` therefore lingers after the answer is already shown, and those tabs' own `error-trace-click.js` / `jaeger-expand.js` still send `statusResult` / `noRecordsFound` / `responseBodyExtracted` replies. `activeSingleSR.resultDelivered` is set `true` once the API paints the final result, and it guards two places:

- `updateSRDisplay()` drops a tab-scrape reply for a `resultDelivered` single-SR instead of painting it — otherwise the slow, throttled dashboard render (the very thing the API path exists to avoid) could overwrite the correct API answer, e.g. a sluggish dashboard firing "No records" over a real API error. While `resultDelivered` is still `false` (API pending, or the `fetch` threw), the tab scrape *does* paint, so it stays the fallback for when the API call fails.
- `cancelSingleSR()` only writes "Search cancelled" when `!resultDelivered`, so the *next* search can't paint "cancelled" over the completed text — a finished search is left intact; only a genuinely in-flight one is cancellable.
