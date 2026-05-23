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

// Export-result tracking. The mapping from a download to "this was our export"
// is persisted in chrome.storage.session — NOT module-scope state — because the
// SW can be evicted while the Save-As dialog sits open (the download() callback
// would then be lost entirely). We record the intent BEFORE calling download()
// and correlate the completion event by id (when the callback survived) or, as
// a fallback, by the saved file's basename.
const INFLIGHT_KEY = "vrbExportInFlight"; // { roleName, filename, id, ts }

// Badge colors (named for readability; mirror the popup's success/error hues).
const BADGE_DONE_COLOR = "#1a7f37"; // success green
const BADGE_FAIL_COLOR = "#b42318"; // error red

const baseName = (p) => String(p || "").split(/[\\/]/).pop();

// When our export download finishes (or fails): store a result the popup can
// display, flag the toolbar badge as a durable signal, and try to re-open the
// popup. Must be a top-level listener so Chrome wakes the SW after eviction.
chrome.downloads.onChanged.addListener(async (delta) => {
  if (!delta.state) return;
  const cur = delta.state.current;
  if (cur !== "complete" && cur !== "interrupted") return;

  const stored = await chrome.storage.session.get(INFLIGHT_KEY);
  const inflight = stored[INFLIGHT_KEY];
  if (!inflight) return;

  // Confirm this is the download we started: prefer the captured id; fall back
  // to the requested basename when eviction lost the download() callback.
  let filePath = "";
  try {
    const items = await chrome.downloads.search({ id: delta.id });
    filePath = (items && items[0] && items[0].filename) || "";
  } catch (_) {}
  const isOurs =
    (inflight.id != null && inflight.id === delta.id) ||
    (!!filePath && baseName(filePath) === inflight.filename);
  if (!isOurs) return;

  await chrome.storage.session.remove(INFLIGHT_KEY);

  const ok = cur === "complete";
  const result = ok
    ? { status: "complete", roleName: inflight.roleName || "", filePath, ts: Date.now() }
    : { status: "interrupted", roleName: inflight.roleName || "", ts: Date.now() };
  await chrome.storage.session.set({ vrbExportResult: result });

  // Durable signal in case openPopup() can't re-open the popup (no focused
  // window, missing gesture, or older Chrome): the badge persists until the
  // user opens the popup, which clears it and shows the result.
  chrome.action.setBadgeText({ text: ok ? "✓" : "!" }).catch(() => {});
  chrome.action
    .setBadgeBackgroundColor({ color: ok ? BADGE_DONE_COLOR : BADGE_FAIL_COLOR })
    .catch(() => {});
  if (chrome.action.openPopup) chrome.action.openPopup().catch(() => {});
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
    //
    // Record the intent first (durable across SW eviction during the dialog),
    // then start the download and best-effort-capture its id for precise
    // completion matching.
    chrome.storage.session
      .set({
        [INFLIGHT_KEY]: {
          roleName: msg.roleName || "",
          filename: baseName(msg.filename),
          id: null,
          ts: Date.now(),
        },
      })
      .then(() => {
        chrome.downloads.download(
          { url: msg.dataUrl, filename: msg.filename, saveAs: true },
          async (id) => {
            if (chrome.runtime.lastError) {
              await chrome.storage.session.remove(INFLIGHT_KEY);
              const errMsg = chrome.runtime.lastError.message || "";
              // Dismissing the Save-As dialog surfaces as a "cancel" lastError;
              // it's a deliberate user action, not a failure. Flag it so the
              // popup returns quietly instead of showing a scary error.
              const canceled = /cancel/i.test(errMsg);
              if (!canceled) console.error("[VRB] download failed:", errMsg);
              sendResponse({ ok: false, error: errMsg, canceled });
              return;
            }
            console.log("[VRB] download started id=" + id);
            try {
              const d = await chrome.storage.session.get(INFLIGHT_KEY);
              if (d[INFLIGHT_KEY]) {
                d[INFLIGHT_KEY].id = id;
                await chrome.storage.session.set({ [INFLIGHT_KEY]: d[INFLIGHT_KEY] });
              }
            } catch (_) {}
            sendResponse({ ok: true, downloadId: id });
          }
        );
      });
    return true; // async — sendResponse called in callback
  }
});
