// 311 SR to Integration Request Finder - Background Service Worker
// Creates context menu and handles menu clicks

//=============================================================================
// CONTEXT MENU SETUP
//=============================================================================

// Create context menu item when extension is installed
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'searchIntegrationRequest',
    title: 'Search Integration Request',
    contexts: ['all'],  // Show on all contexts, control via enabled state
    enabled: false      // Disabled by default until valid SR detected
  });
  console.log('[IR Finder] Context menu created (disabled by default)');
});

//=============================================================================
// MENU STATE UPDATE LISTENER
//=============================================================================

// Listen for validation results from content script to enable/disable menu
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'updateMenuState') {
    // Update context menu enabled state based on validation
    chrome.contextMenus.update('searchIntegrationRequest', {
      enabled: message.isValid
    }).then(() => {
      console.log('[IR Finder] Menu state updated:', message.isValid ? 'enabled' : 'disabled', 
        '| isLink:', message.isLink, '| srNumber:', message.srNumber);
    }).catch(err => {
      console.error('[IR Finder] Failed to update menu state:', err);
    });
  }
});

//=============================================================================
// CONTEXT MENU CLICK HANDLER
//=============================================================================

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === 'searchIntegrationRequest') {
    console.log('[IR Finder] Context menu clicked, tab:', tab.id, 'frameId:', info.frameId);

    try {
      // Method 1: Try sending message to all frames
      await chrome.tabs.sendMessage(tab.id, {
        action: 'searchIntegrationRequest',
        linkUrl: info.linkUrl,
        linkText: info.selectionText || null,
        frameId: info.frameId
      });
      console.log('[IR Finder] Message sent to tab');
    } catch (err) {
      console.log('[IR Finder] sendMessage failed, trying executeScript:', err.message);

      // Method 2: Fallback to executeScript if message fails
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id, allFrames: true },
          func: triggerSearch
        });
        console.log('[IR Finder] executeScript completed');
      } catch (err2) {
        console.error('[IR Finder] executeScript also failed:', err2);
      }
    }
  }
});

// Function to be injected via executeScript
function triggerSearch() {
  // This function runs in the page context
  if (window.irFinderTriggerSearch) {
    window.irFinderTriggerSearch();
  }
}
