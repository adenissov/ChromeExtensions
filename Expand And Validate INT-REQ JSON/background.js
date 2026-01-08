let color = '#3aa757';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ color });
  console.log('Default background color set to %cgreen', `color: ${color}`);
});

// v2.3: Trigger formatting when extension icon is clicked (no popup)
chrome.action.onClicked.addListener(async (tab) => {
  // First, try to inject the content script in case it's not already loaded
  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id, allFrames: true },
      files: ['content.js']
    });
  } catch (e) {
    // Script may already be injected or page doesn't allow injection
    console.log('Script injection skipped:', e.message);
  }
  
  // Send message to content script to trigger processing
  // Use a small delay to ensure the script is ready
  setTimeout(() => {
    chrome.tabs.sendMessage(tab.id, { action: 'processNow' }).catch((error) => {
      console.log('Could not send message:', error.message);
    });
  }, 100);
});