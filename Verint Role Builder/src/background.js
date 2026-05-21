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

// Requirement (2): persist the folder the user picks in the export Save-As
// dialog so the next export reopens there instead of resetting to Downloads
// (Chrome's saveAs dialog always defaults to Downloads — it does not remember
// the last location). On completion we record the absolute directory the file
// landed in; the next export asks for that directory + the basename so the
// dialog reopens there. Chrome rejects absolute / ".." paths in
// downloads.download with a runtime error, so the attempt is guarded: on
// failure we retry once with the bare basename, degrading to Downloads rather
// than failing the export.
const exportDownloadIds = new Set();
const dirOf = (p) => p.replace(/[\/\\][^\/\\]*$/, "");

async function getStore(key) {
  return (await chrome.storage.local.get(key))[key];
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!exportDownloadIds.has(delta.id)) return;
  if (delta.state && delta.state.current === "interrupted") {
    exportDownloadIds.delete(delta.id);
    return;
  }
  if (!delta.filename || !delta.filename.current) return;
  exportDownloadIds.delete(delta.id);
  chrome.storage.local.set({ vrbExportDir: dirOf(delta.filename.current) });
});

// kick off the download with a chosen filename; on a runtime error (e.g. the
// persisted absolute dir rejected) fall back to the bare basename once.
function startDownload(dataUrl, filename, basename) {
  chrome.downloads.download({ url: dataUrl, filename, saveAs: true }, (id) => {
    if (chrome.runtime.lastError) {
      console.error("[VRB] download failed:", chrome.runtime.lastError.message);
      if (filename !== basename) startDownload(dataUrl, basename, basename);
      return;
    }
    exportDownloadIds.add(id);
    console.log("[VRB] download started id=" + id + " target=" + filename);
  });
}

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
    // dialog) proceeds independently. We ack the popup once the download has
    // been kicked off. Errors surface via chrome.runtime.lastError into the SW
    // console; the user sees the real outcome in the Save-As / downloads UI.
    (async () => {
      const dir = await getStore("vrbExportDir");
      const sep = dir && dir.indexOf("\\") >= 0 ? "\\" : "/";
      const target = dir ? dir.replace(/[\/\\]+$/, "") + sep + msg.filename : msg.filename;
      startDownload(msg.dataUrl, target, msg.filename);
      sendResponse({ ok: true });
    })();
    return true; // async sendResponse
  }
});
