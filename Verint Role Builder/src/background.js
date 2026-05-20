// Service worker: single in-flight guard so two popup runs can't apply at
// once. Request/response and progress go popup<->tab directly (all same
// origin); the worker only holds the lock.
//
// Also triggers downloads on behalf of the popup: chrome.downloads.download
// called from a popup with saveAs:true was honored on the first run only —
// Chrome tore the popup down when the Save-As dialog stole focus, and on the
// next run the saveAs hint was dropped, so the file went silently to the
// default Downloads folder. Moving the call into the SW (which outlives the
// popup) makes saveAs:true reliable on every run.
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
  if (msg && msg.bg === "download") {
    // Fire-and-forget: the SW persists past popup teardown, so the download
    // (and its Save-As dialog) proceeds independently. We ack the popup
    // synchronously — awaiting the download promise here caused the response
    // channel to close before sendResponse could fire (popup saw "unknown"
    // error). Errors are surfaced via the callback's chrome.runtime.lastError
    // into the SW console only; the user sees the actual outcome in the
    // Save-As dialog / browser downloads UI.
    try {
      chrome.downloads.download(
        {
          url: msg.dataUrl,
          filename: msg.filename,
          saveAs: true,
        },
        (id) => {
          if (chrome.runtime.lastError) {
            console.error(
              "[VRB] download failed:",
              chrome.runtime.lastError.message
            );
          } else {
            console.log("[VRB] download started id=" + id);
          }
        }
      );
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: String((e && e.message) || e) });
    }
    return; // sync ack
  }
});
