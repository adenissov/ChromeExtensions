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
    contexts: ['link', 'selection']  // Show on links and selected text
  });
  console.log('[IR Finder] Context menu created');
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
