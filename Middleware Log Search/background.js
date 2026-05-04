// Middleware Log Search - Background Service Worker
// Creates context menu and handles menu clicks to open Kibana dashboard

//=============================================================================
// CONSTANTS
//=============================================================================

const KIBANA_URL_TEMPLATE = "http://portal.cc.toronto.ca:5601/app/dashboards#/view/c36f5e40-40fe-11ed-a166-53790178ef13?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-30d,to:now))&_a=(query:(language:kuery,query:'NNNNNNNN'),filters:!(),viewMode:view)";
const KIBANA_URL_TEMPLATE_STAGING = "https://staging.cc.toronto.ca:15601/app/dashboards#/view/2da28bb0-4309-11f1-be7c-49d712de5225?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-30d,to:now))&_a=(query:(language:kuery,query:'NNNNNNNN'),filters:!(),viewMode:view)";
const SR_THRESHOLD = 9227488;

const TIP_CHECK_INTEGRATION_REQUEST = ' ✅Tip:Check Integration Request for validation errors';
const TIP_IBMS_LOCATION_DB = ' ✅Tip: Error in the IBMS location database (likely missing Ward number for this GeoID)';

//=============================================================================
// STATE
//=============================================================================

// Store the SR number from the last validation
let lastValidSRNumber = null;
// Store source tab info for cross-tab communication
let sourceTabId = null;
let elementId = null;

// Queue processing state (for "Search All")
let searchQueue = [];
let currentSearchIndex = -1;
let isProcessingQueue = false;

// Tab tracking for cleanup (queue mode only)
let currentKibanaTabId = null;
let currentJaegerTabId = null;

// Tab IDs whose batch was cancelled — late messages from these tabs are ignored
const cancelledTabIds = new Set();

// In-progress single-SR search context. Null when no single-SR is running.
// Shape: { srNumber, sourceTabId, elementId, kibanaTabId, jaegerTabId }
let activeSingleSR = null;

// Status code and backend value of the current error being traced (for prepending to Jaeger result)
let pendingStatusCode = null;
let pendingBackendValue = null;

// Stored items from last right-click (for "Search All")
let pendingAllItems = [];

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
 * Clear pending Kibana state (status code and backend value)
 */
function getKibanaUrl(srNumber) {
  return parseInt(srNumber, 10) > SR_THRESHOLD
    ? KIBANA_URL_TEMPLATE_STAGING.replace('NNNNNNNN', srNumber)
    : KIBANA_URL_TEMPLATE.replace('NNNNNNNN', srNumber);
}

function clearPendingState() {
  pendingStatusCode = null;
  pendingBackendValue = null;
}

/**
 * If processing a queue, clean up tabs and advance to next item
 */
function advanceQueueIfProcessing() {
  if (isProcessingQueue) {
    cleanupCurrentTabs();
    processNextInQueue();
  }
}

/**
 * Send display update to Salesforce tab
 * @param {string} responseBody - The message to display
 */
function updateSRDisplay(responseBody) {
  if (!sourceTabId || !elementId) {
    console.log('[Middleware Log] Cannot update display - missing sourceTabId or elementId');
    return;
  }

  chrome.tabs.sendMessage(sourceTabId, {
    action: 'updateSRDisplay',
    elementId: elementId,
    srNumber: lastValidSRNumber,
    responseBody: responseBody
  }).catch(error => {
    console.log('[Middleware Log] Failed to update SR display:', error.message);
  });
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
    // Store the SR number and source tab info for later use
    if (message.isValid && message.srNumber) {
      lastValidSRNumber = message.srNumber;
      sourceTabId = sender.tab?.id;
      elementId = message.elementId;
      console.log('[Middleware Log] Stored source tab ID:', sourceTabId, 'element ID:', elementId);
    }

    // Always store source tab ID when in column (for "Search All")
    if (message.isValidColumn) {
      sourceTabId = sender.tab?.id;
    }

    // Update single-SR context menu enabled state.
    // Stays enabled during a batch — clicking it cancels the batch (see cancelQueue).
    chrome.contextMenus.update('middlewareLogSearch', {
      enabled: message.isValid
    });

    // Update "Search All" context menu state — also stays enabled during a batch.
    if (message.isValidColumn && message.allItems && message.allItems.length > 0) {
      pendingAllItems = message.allItems;
      chrome.contextMenus.update('middlewareLogSearchAll', {
        enabled: true
      });
      console.log('[Middleware Log] Search All menu enabled with', pendingAllItems.length, 'items');
    } else {
      pendingAllItems = [];
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
      if (isProcessingQueue) {
        currentJaegerTabId = tab.id;
      } else if (activeSingleSR) {
        activeSingleSR.jaegerTabId = tab.id;
      }
    });
  }

  // Handle direct status result from Kibana (no Jaeger needed)
  if (message.action === 'statusResult') {
    console.log('[Middleware Log] Status result:', message.statusCode, message.displayText);
    updateSRDisplay(message.displayText);
    clearActiveSingleSRIfFromIt(sender.tab?.id);
    advanceQueueIfProcessing();
  }

  // Handle no records found in Kibana (empty table)
  if (message.action === 'noRecordsFound') {
    console.log('[Middleware Log] No records found in Kibana');
    updateSRDisplay('No records in the Middleware log');
    clearActiveSingleSRIfFromIt(sender.tab?.id);
    advanceQueueIfProcessing();
  }

  // Handle response body extracted from Jaeger
  if (message.action === 'responseBodyExtracted') {
    console.log('[Middleware Log] Received response body:', message.responseBody);

    if (message.responseBody) {
      let displayText = message.responseBody;
      if (pendingStatusCode !== null) {
        displayText = formatStatusPrefix(pendingBackendValue, pendingStatusCode) + message.responseBody;
      }
      if (pendingStatusCode === 445 && pendingBackendValue === 'IBMS' &&
          message.responseBody.includes('Neither RequestNumber nor ExternalRequestID found')) {
        displayText += TIP_CHECK_INTEGRATION_REQUEST;
      }
      if (pendingStatusCode === 445 && pendingBackendValue === 'IBMS' &&
          message.responseBody.includes('NO DATA FOUND for some values associated with')) {
        displayText += TIP_IBMS_LOCATION_DB;
      }
      if (pendingStatusCode === 500 && pendingBackendValue === 'MAXIMO' &&
          message.responseBody.includes('object has no attribute')) {
        displayText += TIP_CHECK_INTEGRATION_REQUEST;
      }
      updateSRDisplay(displayText);
    } else {
      console.log('[Middleware Log] Missing response body');
    }

    clearPendingState();
    clearActiveSingleSRIfFromIt(sender.tab?.id);
    advanceQueueIfProcessing();
  }
});

//=============================================================================
// TAB CLEANUP (QUEUE MODE)
//=============================================================================

/**
 * Close current Kibana and Jaeger tabs (used in queue mode)
 */
function cleanupCurrentTabs() {
  if (currentJaegerTabId) {
    chrome.tabs.remove(currentJaegerTabId).catch(() => {});
    currentJaegerTabId = null;
  }
  if (currentKibanaTabId) {
    chrome.tabs.remove(currentKibanaTabId).catch(() => {});
    currentKibanaTabId = null;
  }
}

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

  if (activeSingleSR.sourceTabId) {
    chrome.tabs.sendMessage(activeSingleSR.sourceTabId, {
      action: 'updateSRDisplay',
      elementId: activeSingleSR.elementId,
      srNumber: activeSingleSR.srNumber,
      responseBody: 'Search cancelled'
    }).catch(() => {});
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
 * either context-menu item while a batch is running. Marks the current
 * Kibana/Jaeger tabs so any in-flight messages from them are dropped,
 * shows "Search cancelled" on the in-progress item's cell, closes the
 * tabs, and resets queue state. Safe to call when no batch is running.
 */
function cancelQueue() {
  if (!isProcessingQueue) return;

  console.log('[Middleware Log] Cancelling Search All queue');

  if (currentKibanaTabId) cancelledTabIds.add(currentKibanaTabId);
  if (currentJaegerTabId) cancelledTabIds.add(currentJaegerTabId);

  const currentItem = currentSearchIndex >= 0 && currentSearchIndex < searchQueue.length
    ? searchQueue[currentSearchIndex]
    : null;
  if (currentItem && sourceTabId) {
    chrome.tabs.sendMessage(sourceTabId, {
      action: 'updateSRDisplay',
      elementId: currentItem.elementId,
      srNumber: currentItem.srNumber,
      responseBody: 'Search cancelled'
    }).catch(() => {});
  }

  isProcessingQueue = false;
  searchQueue = [];
  currentSearchIndex = -1;
  cleanupCurrentTabs();
  clearPendingState();
}

//=============================================================================
// QUEUE PROCESSING (SEARCH ALL)
//=============================================================================

/**
 * Process the next item in the search queue
 */
function processNextInQueue() {
  currentSearchIndex++;
  clearPendingState();

  if (currentSearchIndex >= searchQueue.length) {
    // All done
    console.log('[Middleware Log] Queue processing complete');
    isProcessingQueue = false;
    currentSearchIndex = -1;
    searchQueue = [];
    return;
  }

  const item = searchQueue[currentSearchIndex];
  console.log('[Middleware Log] Processing', currentSearchIndex + 1, '/', searchQueue.length, '- SR:', item.srNumber);

  // Update tracking variables for message routing
  elementId = item.elementId;
  lastValidSRNumber = item.srNumber;

  // Update SR to "Searching..."
  chrome.tabs.sendMessage(sourceTabId, {
    action: 'updateSRDisplay',
    elementId: item.elementId,
    srNumber: item.srNumber,
    responseBody: 'Searching in the Middleware log...'
  }).catch(error => {
    console.log('[Middleware Log] Failed to update SR display:', error.message);
  });

  // Open Kibana (with tab ID tracking)
  const kibanaUrl = getKibanaUrl(item.srNumber);
  chrome.tabs.create({ url: kibanaUrl, active: false }, (tab) => {
    currentKibanaTabId = tab.id;

    // Per-item timeout. Generous to accommodate ByteStream OSD pages, which load
    // slowly when many tabs queue up and Chrome throttles background tabs.
    const timeoutSrNumber = item.srNumber;
    setTimeout(() => {
      if (isProcessingQueue && currentSearchIndex < searchQueue.length) {
        const currentItem = searchQueue[currentSearchIndex];
        if (currentItem && currentItem.srNumber === timeoutSrNumber) {
          console.log('[Middleware Log] Timeout for SR:', timeoutSrNumber);
          // Build timeout message with status code if available
          let timeoutMessage = 'No records in the Middleware log';
          if (pendingStatusCode !== null) {
            timeoutMessage = formatStatusPrefix(pendingBackendValue, pendingStatusCode) + 'Jaeger extraction timed out';
            clearPendingState();
          }
          // Update display to show timeout
          chrome.tabs.sendMessage(sourceTabId, {
            action: 'updateSRDisplay',
            elementId: item.elementId,
            srNumber: item.srNumber,
            responseBody: timeoutMessage
          }).catch(() => {});
          cleanupCurrentTabs();
          processNextInQueue();
        }
      }
    }, 30000);
  });
}

//=============================================================================
// MENU CLICK HANDLER
//=============================================================================

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // Handle single SR search
  if (info.menuItemId === 'middlewareLogSearch') {
    console.log('[Middleware Log] Menu clicked, SR number:', lastValidSRNumber);

    if (lastValidSRNumber) {
      cancelSingleSR();
      cancelQueue();

      // Construct the Kibana URL with the SR number
      const kibanaUrl = getKibanaUrl(lastValidSRNumber);

      // Immediately update Salesforce to show "Searching..." message
      if (sourceTabId && elementId) {
        chrome.tabs.sendMessage(sourceTabId, {
          action: 'updateSRDisplay',
          elementId: elementId,
          srNumber: lastValidSRNumber,
          responseBody: 'Searching in the Middleware log...'
        }).catch(error => {
          console.log('[Middleware Log] Failed to send searching message:', error.message);
        });
      }

      // Open in new background tab (keep Salesforce tab on top) and remember
      // its context so a subsequent click can cancel it cleanly.
      const startedSrNumber = lastValidSRNumber;
      const startedSourceTabId = sourceTabId;
      const startedElementId = elementId;
      chrome.tabs.create({ url: kibanaUrl, active: false }, (tab) => {
        activeSingleSR = {
          srNumber: startedSrNumber,
          sourceTabId: startedSourceTabId,
          elementId: startedElementId,
          kibanaTabId: tab.id,
          jaegerTabId: null
        };
      });
      console.log('[Middleware Log] Opening Kibana URL for SR:', lastValidSRNumber);
    } else {
      console.log('[Middleware Log] No SR number available');
    }
  }

  // Handle "Search All" in column
  if (info.menuItemId === 'middlewareLogSearchAll') {
    if (pendingAllItems.length === 0) {
      console.log('[Middleware Log] No items to process');
      return;
    }

    cancelSingleSR();
    cancelQueue();

    // Initialize queue
    searchQueue = [...pendingAllItems];
    currentSearchIndex = -1;
    isProcessingQueue = true;

    console.log('[Middleware Log] Starting Search All with', searchQueue.length, 'items');
    processNextInQueue();
  }
});
