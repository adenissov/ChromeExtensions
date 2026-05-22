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
// IDs of downloads this extension initiated, so we know when to re-open the
// popup. Module-scope so the SW can match them in the onChanged listener even
// after the popup is torn down by the Save-As focus-steal.
const vrbDownloadIds = new Set();
const vrbDownloadMeta = new Map(); // downloadId -> { roleName }

// When our export download finishes: store the result for the popup to display,
// then re-open the popup. Must be at module scope so Chrome wakes the SW.
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!vrbDownloadIds.has(delta.id)) return;
  if (!delta.state) return;
  if (delta.state.current === "complete" || delta.state.current === "interrupted") {
    const id = delta.id;
    const meta = vrbDownloadMeta.get(id) || {};
    vrbDownloadIds.delete(id);
    vrbDownloadMeta.delete(id);
    if (delta.state.current === "complete") {
      try {
        const items = await chrome.downloads.search({ id });
        const filePath = (items && items[0] && items[0].filename) || "";
        await chrome.storage.session.set({
          vrbExportResult: { roleName: meta.roleName || "", filePath },
        });
      } catch (_) {}
    }
    chrome.action.openPopup().catch(() => {});
  }
});

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
    // The SW persists past popup teardown, so the download (and its Save-As
    // dialog) proceeds independently. chrome.downloads.download's `filename`
    // must be RELATIVE to the default Downloads dir — an absolute path is
    // rejected with "Invalid filename" — so we pass only the basename and let
    // the Save-As dialog choose (and remember) the directory.
    chrome.downloads.download(
      { url: msg.dataUrl, filename: msg.filename, saveAs: true },
      (id) => {
        if (chrome.runtime.lastError) {
          console.error("[VRB] download failed:", chrome.runtime.lastError.message);
          sendResponse({ ok: false, error: chrome.runtime.lastError.message });
          return;
        }
        console.log("[VRB] download started id=" + id);
        vrbDownloadIds.add(id);
        vrbDownloadMeta.set(id, { roleName: msg.roleName || "" });
        sendResponse({ ok: true, downloadId: id });
      }
    );
    return true; // async — sendResponse called in callback
  }
});
