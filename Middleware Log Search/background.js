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

//=============================================================================
// CONTEXT MENU SETUP
//=============================================================================

// Create context menu item when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'middlewareLogSearch',
    title: 'Search in Middleware Log',
    contexts: ['all'],
    enabled: false  // Disabled by default until valid SR detected
  });
  console.log('[Middleware Log] Context menu created (disabled by default)');
});

//=============================================================================
// MENU STATE UPDATE LISTENER
//=============================================================================

// Listen for validation results from content script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateMenuState') {
    // Store the SR number for later use
    if (message.isValid && message.srNumber) {
      lastValidSRNumber = message.srNumber;
    }
    
    // Update context menu enabled state
    chrome.contextMenus.update('middlewareLogSearch', {
      enabled: message.isValid
    });
    console.log('[Middleware Log] Menu state updated:', message.isValid ? 'enabled' : 'disabled', 
                message.isValid ? `(SR: ${message.srNumber})` : '');
  }
});

//=============================================================================
// MENU CLICK HANDLER
//=============================================================================

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'middlewareLogSearch') {
    console.log('[Middleware Log] Menu clicked, SR number:', lastValidSRNumber);
    
    if (lastValidSRNumber) {
      // Construct the Kibana URL with the SR number
      const kibanaUrl = KIBANA_URL_TEMPLATE.replace('NNNNNNNN', lastValidSRNumber);
      
      // Open in new tab
      chrome.tabs.create({ url: kibanaUrl });
      console.log('[Middleware Log] Opening Kibana URL for SR:', lastValidSRNumber);
    } else {
      console.error('[Middleware Log] No SR number available');
    }
  }
});
