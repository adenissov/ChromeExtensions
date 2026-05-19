// Service worker: single in-flight guard so two popup runs can't apply at
// once. Request/response and progress go popup<->tab directly (all same
// origin); the worker only holds the lock.
let applyInFlight = false;

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg && msg.bg === "acquire") {
    if (applyInFlight) {
      sendResponse({ ok: false, busy: true });
    } else {
      applyInFlight = true;
      sendResponse({ ok: true });
    }
    return; // sync
  }
  if (msg && msg.bg === "release") {
    applyInFlight = false;
    sendResponse({ ok: true });
    return;
  }
});
