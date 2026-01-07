// popup.js v2.2 - Simplified manual trigger
// The main logic is now in content.js which auto-triggers on page load and tab switch
// This popup button serves as a manual fallback

let changeColor = document.getElementById("changeColor");

chrome.storage.sync.get("color", ({ color }) => {
  changeColor.style.backgroundColor = color;
});

// When the button is clicked, send message to content script to process
changeColor.addEventListener("click", async () => {
  let [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Send message to content script to trigger processing
  chrome.tabs.sendMessage(tab.id, { action: 'processNow' });
});
