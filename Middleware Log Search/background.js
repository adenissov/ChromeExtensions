// Middleware Log Search - Background Service Worker
// Creates context menu and handles menu clicks to open Kibana dashboard

//=============================================================================
// CONSTANTS
//=============================================================================

const KIBANA_URL_TEMPLATE = "http://portal.cc.toronto.ca:5601/app/dashboards#/view/c36f5e40-40fe-11ed-a166-53790178ef13?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-30d,to:now))&_a=(query:(language:kuery,query:'NNNNNNNN'),filters:!(),viewMode:view)";

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

// Stored items from last right-click (for "Search All")
let pendingAllItems = [];

//=============================================================================
// HELPER FUNCTIONS
//=============================================================================

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

//=============================================================================
// MENU STATE UPDATE LISTENER
//=============================================================================

// Listen for validation results from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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

    // Update single-SR context menu enabled state
    // Disable if queue is processing
    chrome.contextMenus.update('middlewareLogSearch', {
      enabled: message.isValid && !isProcessingQueue
    });

    // Update "Search All" context menu state
    if (message.isValidColumn && message.allItems && message.allItems.length > 0) {
      pendingAllItems = message.allItems;
      chrome.contextMenus.update('middlewareLogSearchAll', {
        enabled: !isProcessingQueue
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
    console.log('[Middleware Log] Opening in background tab:', message.url);
    chrome.tabs.create({ url: message.url, active: false }, (tab) => {
      if (isProcessingQueue) {
        currentJaegerTabId = tab.id;
      }
    });
  }

  // Handle no errors found in Kibana (no status code >= 300)
  if (message.action === 'noErrorsFound') {
    console.log('[Middleware Log] No errors found in Kibana');
    updateSRDisplay('Waiting for a BackEnd ID...');

    if (isProcessingQueue) {
      cleanupCurrentTabs();
      processNextInQueue();
    }
  }

  // Handle no records found in Kibana (empty table)
  if (message.action === 'noRecordsFound') {
    console.log('[Middleware Log] No records found in Kibana');
    updateSRDisplay('No records in Middleware log');

    if (isProcessingQueue) {
      cleanupCurrentTabs();
      processNextInQueue();
    }
  }

  // Handle response body extracted from Jaeger
  if (message.action === 'responseBodyExtracted') {
    console.log('[Middleware Log] Received response body:', message.responseBody);

    if (message.responseBody) {
      updateSRDisplay(message.responseBody);
    } else {
      console.log('[Middleware Log] Missing response body');
    }

    if (isProcessingQueue) {
      cleanupCurrentTabs();
      processNextInQueue();
    }
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

//=============================================================================
// QUEUE PROCESSING (SEARCH ALL)
//=============================================================================

/**
 * Process the next item in the search queue
 */
function processNextInQueue() {
  currentSearchIndex++;

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
  const kibanaUrl = KIBANA_URL_TEMPLATE.replace('NNNNNNNN', item.srNumber);
  chrome.tabs.create({ url: kibanaUrl, active: false }, (tab) => {
    currentKibanaTabId = tab.id;

    // Set timeout for this item (12 seconds - fallback after 10-second Jaeger timeout)
    const timeoutSrNumber = item.srNumber;
    setTimeout(() => {
      if (isProcessingQueue && currentSearchIndex < searchQueue.length) {
        const currentItem = searchQueue[currentSearchIndex];
        if (currentItem && currentItem.srNumber === timeoutSrNumber) {
          console.log('[Middleware Log] Timeout for SR:', timeoutSrNumber);
          // Update display to show timeout
          chrome.tabs.sendMessage(sourceTabId, {
            action: 'updateSRDisplay',
            elementId: item.elementId,
            srNumber: item.srNumber,
            responseBody: 'No records in Middleware log'
          }).catch(() => {});
          cleanupCurrentTabs();
          processNextInQueue();
        }
      }
    }, 12000);
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
      // Construct the Kibana URL with the SR number
      const kibanaUrl = KIBANA_URL_TEMPLATE.replace('NNNNNNNN', lastValidSRNumber);

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

      // Open in new background tab (keep Salesforce tab on top)
      chrome.tabs.create({ url: kibanaUrl, active: false });
      console.log('[Middleware Log] Opening Kibana URL for SR:', lastValidSRNumber);
    } else {
      console.error('[Middleware Log] No SR number available');
    }
  }

  // Handle "Search All" in column
  if (info.menuItemId === 'middlewareLogSearchAll') {
    if (isProcessingQueue) {
      console.log('[Middleware Log] Already processing queue, ignoring click');
      return;
    }

    if (pendingAllItems.length === 0) {
      console.log('[Middleware Log] No items to process');
      return;
    }

    // Initialize queue
    searchQueue = [...pendingAllItems];
    currentSearchIndex = -1;
    isProcessingQueue = true;

    console.log('[Middleware Log] Starting Search All with', searchQueue.length, 'items');
    processNextInQueue();
  }
});
