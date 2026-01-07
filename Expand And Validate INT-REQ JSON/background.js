let color = '#3aa757';

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.sync.set({ color });
  console.log('Default background color set to %cgreen', `color: ${color}`);
});

// v2.3: Trigger formatting when extension icon is clicked (no popup)
chrome.action.onClicked.addListener((tab) => {
  // Send message to content script to trigger processing
  chrome.tabs.sendMessage(tab.id, { action: 'processNow' });
});