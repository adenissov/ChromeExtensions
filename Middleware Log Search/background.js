// Middleware Log Search - Background Service Worker
// Creates the context menu and handles menu clicks: queries the OSD search API
// for each SR (osd-api.js) and opens the dashboard tab for a closer look.

// row-classify.js first — osd-api.js calls classifyStatusRows from it.
importScripts('row-classify.js', 'osd-api.js');

//=============================================================================
// CONSTANTS
//=============================================================================

// Staging ByteStream O11Y dashboard. The legacy Kibana stack (portal.cc.toronto.ca:5601)
// was retired — old SRs are no longer searched — so there is only one dashboard now.
const DASHBOARD_URL_TEMPLATE = "https://staging.cc.toronto.ca:15601/app/dashboards#/view/2da28bb0-4309-11f1-be7c-49d712de5225?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-30d,to:now))&_a=(query:(language:kuery,query:'span.attributes.http@request@header@requestnumber:%22NNNNNNNN%22'),filters:!(),viewMode:view)";

const TIP_CHECK_INTEGRATION_REQUEST = ' ✅Tip:Check Integration Request for validation errors';
const TIP_IBMS_LOCATION_DB = ' ✅Tip: Error in the IBMS location database (likely missing Ward number for this GeoID). Open a ticket in Jira IBMS Intake';

//=============================================================================
// STATE
//=============================================================================

// Last right-click context, bridging the right-click (updateMenuState) to the
// later menu click (onClicked) — the context-menu API hands onClicked nothing
// about what was under the cursor. Shape: { tabId, srNumber, elementId, allItems }.
let lastRightClick = { tabId: null, srNumber: null, elementId: null, allItems: [] };

// Batch ("Search All") state. The batch runs entirely through the OSD API
// (runApiBatch) — no tabs are opened — so there is no per-tab tracking here.
let searchQueue = [];
let currentSearchIndex = -1;
let isProcessingQueue = false;
// Salesforce tab a running batch paints into (set when a batch starts).
let batchSourceTabId = null;

// Tab IDs (single-SR dashboard/trace tabs) whose search was cancelled — late
// messages from these tabs are ignored.
const cancelledTabIds = new Set();

// In-progress single-SR search context. Null when no single-SR is running.
// Shape: { srNumber, sourceTabId, elementId, kibanaTabId, jaegerTabId, resultDelivered }
let activeSingleSR = null;

// Status code and backend value of the current error being traced (for prepending to Jaeger result)
let pendingStatusCode = null;
let pendingBackendValue = null;

//=============================================================================
// HELPER FUNCTIONS
//=============================================================================

/**
 * Build display prefix from backend value and status code
 * @param {string} backendValue - The Backend column value
 * @param {number} statusCode - The HTTP status code
 * @returns {string} - Formatted prefix, e.g. "(Backend=ABC, Status=404) "
 */
function formatStatusPrefix(backendValue, statusCode) {
  return '(Backend=' + backendValue + ', Status=' + statusCode + ') ';
}

/**
 * Build the full error-cell text: status prefix + response body + any hint tips.
 * Shared by the single-SR trace flow and the batch API flow so both render
 * identically. statusCode null/undefined omits the prefix.
 */
function formatErrorDisplay(statusCode, backendValue, responseBody) {
  const hasStatus = statusCode !== null && statusCode !== undefined;
  let displayText = hasStatus
    ? formatStatusPrefix(backendValue, statusCode) + responseBody
    : responseBody;

  if (statusCode === 445 && backendValue === 'IBMS' &&
      responseBody.includes('Neither RequestNumber nor ExternalRequestID found')) {
    displayText += TIP_CHECK_INTEGRATION_REQUEST;
  }
  if (statusCode === 445 && backendValue === 'IBMS' &&
      responseBody.includes('NO DATA FOUND for some values associated with')) {
    displayText += TIP_IBMS_LOCATION_DB;
  }
  if (statusCode === 500 && backendValue === 'MAXIMO' &&
      responseBody.includes('object has no attribute')) {
    displayText += TIP_CHECK_INTEGRATION_REQUEST;
  }
  if (responseBody.includes('can not find match externalRequestId for requestNumber')) {
    displayText += TIP_CHECK_INTEGRATION_REQUEST;
  }
  if (hasStatus && statusCode >= 400 && statusCode < 500 &&
      responseBody.includes('Either the Request Number or the Customer Request Number is null')) {
    displayText += TIP_CHECK_INTEGRATION_REQUEST;
  }
  return displayText;
}

/**
 * Build the dashboard URL for an SR (all SRs are on the staging dashboard now).
 */
function getDashboardUrl(srNumber) {
  return DASHBOARD_URL_TEMPLATE.replace('NNNNNNNN', srNumber);
}

/**
 * Clear pending trace state (status code and backend value).
 */
function clearPendingState() {
  pendingStatusCode = null;
  pendingBackendValue = null;
}

/**
 * Paint an SR cell in the Salesforce tab. The single place that builds the
 * updateSRDisplay message. Missing tab/element is a no-op; send failures
 * (tab closed, context invalidated) are swallowed.
 * @param {number} tabId - Salesforce tab to message
 * @param {string} elementId - data-mwlog-id of the target SR link
 * @param {string} srNumber - SR number (leading token of the cell)
 * @param {string} text - Display text to render
 * @param {boolean} [isSearching=false] - True while a search is in flight (shows the spinner)
 */
function paintCell(tabId, elementId, srNumber, text, isSearching = false) {
  if (!tabId || !elementId) {
    console.log('[Middleware Log] paintCell skipped - missing tab/element for SR', srNumber, '(tab:', tabId, 'el:', elementId, ')');
    return;
  }
  chrome.tabs.sendMessage(tabId, {
    action: 'updateSRDisplay',
    elementId,
    srNumber,
    responseBody: text,
    isSearching
  }).catch(error => {
    // Tab closed or content script orphaned (extension reloaded without a page refresh).
    console.log('[Middleware Log] paintCell failed for SR', srNumber, '-', error.message);
  });
}

/**
 * Resolve which SR cell a tab-scrape reply belongs to, from the in-flight
 * search context, by matching the sender (Kibana/Jaeger) tab. Returns
 * { tabId, elementId, srNumber } for the Salesforce cell, or null if the
 * sender doesn't belong to any active search (stale/late message).
 */
function resolveReplyTarget(senderTabId) {
  if (!senderTabId) return null;
  if (activeSingleSR &&
      (senderTabId === activeSingleSR.kibanaTabId || senderTabId === activeSingleSR.jaegerTabId)) {
    return { tabId: activeSingleSR.sourceTabId, elementId: activeSingleSR.elementId, srNumber: activeSingleSR.srNumber };
  }
  return null;
}

/**
 * Paint the SR cell for a tab-scrape reply, routed by the sender tab rather
 * than by mutable globals (so a later right-click can't redirect it).
 * @param {number} senderTabId - The Kibana/Jaeger tab the reply came from
 * @param {string} responseBody - The message to display
 */
function updateSRDisplay(senderTabId, responseBody) {
  const target = resolveReplyTarget(senderTabId);
  if (!target) {
    console.log('[Middleware Log] Dropping reply - no active search owns tab', senderTabId);
    return;
  }
  // API fast-path: once the API has painted the cell (resultDelivered), the
  // dashboard tab is open only for the human to inspect. Its (slower, throttled)
  // scrape must not overwrite the delivered answer — e.g. a sluggish dashboard
  // render firing "No records" over a correct API error. If the API hasn't
  // delivered yet (still pending, or it failed), resultDelivered is false and the
  // tab scrape still paints, acting as the fallback it always was for legacy SRs.
  if (activeSingleSR && activeSingleSR.resultDelivered &&
      (senderTabId === activeSingleSR.kibanaTabId || senderTabId === activeSingleSR.jaegerTabId)) {
    console.log('[Middleware Log] Dropping tab reply - API already delivered result for SR', activeSingleSR.srNumber);
    return;
  }
  paintCell(target.tabId, target.elementId, target.srNumber, responseBody);
}

//=============================================================================
// CONTEXT MENU SETUP
//=============================================================================

// Create context menu items when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'middlewareLogSearch',
      title: 'Search this SR in Middleware Log',
      contexts: ['all'],
      enabled: false  // Disabled by default until valid SR detected
    });
    chrome.contextMenus.create({
      id: 'separator',
      type: 'separator',
      contexts: ['all']
    });
    chrome.contextMenus.create({
      id: 'middlewareLogSearchAll',
      title: 'Search All SRs in Middleware Log',
      contexts: ['all'],
      enabled: false  // Disabled by default until in Request Number column
    });
    console.log('[Middleware Log] Context menus created (disabled by default)');
  });
});

//=============================================================================
// MENU STATE UPDATE LISTENER
//=============================================================================

// Listen for validation results from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Drop messages from tabs whose batch was cancelled (Kibana/Jaeger tabs only;
  // Salesforce tabs are never added to cancelledTabIds, so updateMenuState passes).
  if (sender.tab?.id && cancelledTabIds.has(sender.tab.id)) {
    console.log('[Middleware Log] Ignoring message from cancelled tab:', sender.tab.id, message.action);
    return;
  }

  if (message.action === 'updateMenuState') {
    // Record the right-click context for the later menu click.
    if (message.isValid && message.srNumber) {
      lastRightClick.srNumber = message.srNumber;
      lastRightClick.elementId = message.elementId;
      lastRightClick.tabId = sender.tab?.id;
      console.log('[Middleware Log] Stored right-click tab ID:', lastRightClick.tabId, 'element ID:', lastRightClick.elementId);
    }

    // Always store source tab ID when in column (for "Search All")
    if (message.isValidColumn) {
      lastRightClick.tabId = sender.tab?.id;
    }

    // Update single-SR context menu enabled state.
    // Stays enabled during a batch — clicking it cancels the batch (see cancelQueue).
    chrome.contextMenus.update('middlewareLogSearch', {
      enabled: message.isValid
    });

    // Update "Search All" context menu state — also stays enabled during a batch.
    if (message.isValidColumn && message.allItems && message.allItems.length > 0) {
      lastRightClick.allItems = message.allItems;
      chrome.contextMenus.update('middlewareLogSearchAll', {
        enabled: true
      });
      console.log('[Middleware Log] Search All menu enabled with', lastRightClick.allItems.length, 'items');
    } else {
      lastRightClick.allItems = [];
      chrome.contextMenus.update('middlewareLogSearchAll', { enabled: false });
    }

    console.log('[Middleware Log] Menu state updated:', message.isValid ? 'enabled' : 'disabled',
                message.isValid ? `(SR: ${message.srNumber})` : '');
  }

  // Handle request to open URL in background tab
  if (message.action === 'openInBackground') {
    console.log('[Middleware Log] Opening in background tab:', message.url, 'status:', message.statusCode, 'backend:', message.backendValue);
    pendingStatusCode = message.statusCode || null;
    pendingBackendValue = message.backendValue || '';
    chrome.tabs.create({ url: message.url, active: false }, (tab) => {
      // Track the trace tab so its reply can be routed and the tab cancelled.
      // The cell is already populated by the API; this tab is for the human to
      // inspect, so a delivered result is not overwritten (see updateSRDisplay).
      if (activeSingleSR) {
        activeSingleSR.jaegerTabId = tab.id;
      }
    });
  }

  // Handle direct status result from the dashboard (no trace page needed)
  if (message.action === 'statusResult') {
    console.log('[Middleware Log] Status result:', message.statusCode, message.displayText);
    updateSRDisplay(sender.tab?.id, message.displayText);
    clearActiveSingleSRIfFromIt(sender.tab?.id);
  }

  // Handle no records found in the dashboard (empty table)
  if (message.action === 'noRecordsFound') {
    console.log('[Middleware Log] No records found in dashboard');
    updateSRDisplay(sender.tab?.id, 'No records in the Middleware log');
    clearActiveSingleSRIfFromIt(sender.tab?.id);
  }

  // Handle response body extracted from the trace page
  if (message.action === 'responseBodyExtracted') {
    console.log('[Middleware Log] Received response body:', message.responseBody);

    if (message.responseBody === 'No records in the Middleware log') {
      console.log('[Middleware Log] Ignoring legacy trace-page no-records fallback from tab:', sender.tab?.id);
      return;
    }

    if (message.responseBody) {
      updateSRDisplay(sender.tab?.id, formatErrorDisplay(pendingStatusCode, pendingBackendValue, message.responseBody));
    } else {
      console.log('[Middleware Log] Missing response body');
    }

    clearPendingState();
    clearActiveSingleSRIfFromIt(sender.tab?.id);
  }
});

//=============================================================================
// CANCELLATION
//=============================================================================

/**
 * Cancel an in-progress single-SR search. Mirrors cancelQueue but for the
 * single-SR mode: marks tabs as cancelled, shows "Search cancelled" on the
 * cell, closes tabs, clears activeSingleSR. Safe to call when no single-SR
 * is in progress.
 */
function cancelSingleSR() {
  if (!activeSingleSR) return;

  console.log('[Middleware Log] Cancelling single-SR search for', activeSingleSR.srNumber);

  if (activeSingleSR.kibanaTabId) cancelledTabIds.add(activeSingleSR.kibanaTabId);
  if (activeSingleSR.jaegerTabId) cancelledTabIds.add(activeSingleSR.jaegerTabId);

  // Only paint "Search cancelled" if the search was genuinely still in flight.
  // In API mode the cell already holds the final result (resultDelivered) even
  // though the dashboard tab lingers — don't clobber it.
  if (!activeSingleSR.resultDelivered) {
    paintCell(activeSingleSR.sourceTabId, activeSingleSR.elementId, activeSingleSR.srNumber, 'Search cancelled');
  }

  if (activeSingleSR.jaegerTabId) {
    chrome.tabs.remove(activeSingleSR.jaegerTabId).catch(() => {});
  }
  if (activeSingleSR.kibanaTabId) {
    chrome.tabs.remove(activeSingleSR.kibanaTabId).catch(() => {});
  }

  activeSingleSR = null;
}

/**
 * Clear activeSingleSR if the message that just arrived is from one of its
 * tabs (i.e. its search just completed). No-op otherwise.
 */
function clearActiveSingleSRIfFromIt(senderTabId) {
  if (!activeSingleSR || !senderTabId) return;
  if (senderTabId === activeSingleSR.kibanaTabId || senderTabId === activeSingleSR.jaegerTabId) {
    activeSingleSR = null;
  }
}

/**
 * Cancel an in-progress "Search All" batch. Called when the user clicks
 * either context-menu item while a batch is running. Invalidates the running
 * API batch loop (apiBatchId), shows "Search cancelled" on the in-progress
 * item's cell, and resets batch state. Safe to call when no batch is running.
 */
function cancelQueue() {
  if (!isProcessingQueue) return;

  console.log('[Middleware Log] Cancelling Search All queue');

  apiBatchId++;  // invalidate any running API batch loop

  const currentItem = currentSearchIndex >= 0 && currentSearchIndex < searchQueue.length
    ? searchQueue[currentSearchIndex]
    : null;
  if (currentItem) {
    paintCell(batchSourceTabId, currentItem.elementId, currentItem.srNumber, 'Search cancelled');
  }

  isProcessingQueue = false;
  searchQueue = [];
  currentSearchIndex = -1;
  clearPendingState();
}

//=============================================================================
// QUEUE PROCESSING (SEARCH ALL — API MODE)
//=============================================================================

// Monotonic id so a cancelled/superseded batch loop stops at its next checkpoint.
let apiBatchId = 0;

/**
 * Convert an osdLookupSR result into the SR-cell text, reusing the same
 * formatting (and hint tips) as the single-SR dashboard-tab fallback
 * (formatStatusPrefix / formatErrorDisplay).
 */
function apiResultToText(result) {
  switch (result.kind) {
    case 'success': {
      const message = result.statusCode === 200
        ? 'Sent request to back-end'
        : 'Back-end Id received: ' + result.extReqId;
      return formatStatusPrefix(result.backend, result.statusCode) + message;
    }
    case 'error':
      return formatErrorDisplay(result.statusCode, result.backend, result.responseBody);
    case 'fetchError':
      return 'Middleware log search failed: ' + result.message;
    case 'noRecords':
    default:
      return 'No records in the Middleware log';
  }
}

/**
 * Batch "Search All" via the OSD API: query each SR directly (no tabs, no
 * throttled background rendering) and update its cell as the result returns.
 * Single-SR search is unaffected — it still opens the dashboard tab.
 */
async function runApiBatch(items, sfTabId) {
  const myId = ++apiBatchId;
  isProcessingQueue = true;
  batchSourceTabId = sfTabId;
  searchQueue = items.slice();
  currentSearchIndex = -1;

  console.log('[Middleware Log] API batch started:', searchQueue.length, 'items');

  for (let i = 0; i < searchQueue.length; i++) {
    if (myId !== apiBatchId) return;  // cancelled or superseded
    currentSearchIndex = i;
    const item = searchQueue[i];

    paintCell(batchSourceTabId, item.elementId, item.srNumber, 'Searching in the Middleware log...', true);

    let result;
    try {
      result = await osdLookupSR(item.srNumber);
    } catch (e) {
      console.log('[Middleware Log] API batch lookup failed for', item.srNumber, '-', e.message);
      result = { kind: 'fetchError', message: e.message };
    }
    if (myId !== apiBatchId) return;  // cancelled while awaiting

    paintCell(batchSourceTabId, item.elementId, item.srNumber, apiResultToText(result));
  }

  if (myId === apiBatchId) {
    console.log('[Middleware Log] API batch complete:', searchQueue.length, 'items');
    isProcessingQueue = false;
    searchQueue = [];
    currentSearchIndex = -1;
  }
}

//=============================================================================
// MENU CLICK HANDLER
//=============================================================================

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // Handle single SR search
  if (info.menuItemId === 'middlewareLogSearch') {
    console.log('[Middleware Log] Menu clicked, SR number:', lastRightClick.srNumber);

    if (lastRightClick.srNumber) {
      cancelSingleSR();
      cancelQueue();

      const startedSrNumber = lastRightClick.srNumber;
      const startedSourceTabId = lastRightClick.tabId;
      const startedElementId = lastRightClick.elementId;

      const dashboardUrl = getDashboardUrl(startedSrNumber);

      // Immediately update Salesforce to show "Searching..." message
      paintCell(startedSourceTabId, startedElementId, startedSrNumber, 'Searching in the Middleware log...', true);

      // Fast path: populate the cell from the API while the dashboard tab loads.
      if (startedSourceTabId && startedElementId) {
        osdLookupSR(startedSrNumber).then((result) => {
          paintCell(startedSourceTabId, startedElementId, startedSrNumber, apiResultToText(result));
          // The cell now holds the final API result. Mark the search delivered so
          // a later cancel won't overwrite it with "cancelled", and the dashboard
          // tab's own (slower) scrape won't overwrite it either (see updateSRDisplay).
          if (activeSingleSR && activeSingleSR.srNumber === startedSrNumber &&
              activeSingleSR.elementId === startedElementId) {
            activeSingleSR.resultDelivered = true;
          }
        }).catch((e) => {
          // API failed: leave resultDelivered false so the dashboard tab's scrape
          // can still paint the cell as the fallback.
          console.log('[Middleware Log] Single-SR API lookup failed:', e.message);
        });
      }

      // Open the dashboard in a background tab (kept open for a close look; for
      // errors it also opens the trace page). Remember its context so a subsequent
      // click can cancel it cleanly.
      chrome.tabs.create({ url: dashboardUrl, active: false }, (tab) => {
        activeSingleSR = {
          srNumber: startedSrNumber,
          sourceTabId: startedSourceTabId,
          elementId: startedElementId,
          kibanaTabId: tab.id,
          jaegerTabId: null,
          resultDelivered: false
        };
      });
      console.log('[Middleware Log] Opening dashboard for SR:', startedSrNumber);
    } else {
      console.log('[Middleware Log] No SR number available');
    }
  }

  // Handle "Search All" in column
  if (info.menuItemId === 'middlewareLogSearchAll') {
    if (lastRightClick.allItems.length === 0) {
      console.log('[Middleware Log] No items to process');
      return;
    }

    cancelSingleSR();
    cancelQueue();

    // Batch runs through the OSD API directly (runApiBatch sets queue state).
    runApiBatch([...lastRightClick.allItems], lastRightClick.tabId);
  }
});
