// Orchestrator content script (top frame of the Verint tab). All Roles Setup
// frames are same-origin, so we reach the nested panes via contentDocument
// (exactly as the recon evals did). Selectors: see dev/recon/create-dialog-recon.md.
(function (root) {
  const VRB = (root.VRB = root.VRB || {});
  const E = VRB.engine;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let trace = [];

  // Persist the outcome BEFORE any potentially-blocking UI action (Cancel on
  // a dirty form triggers Verint's native confirm, which steals focus and
  // closes the MV3 popup). Storing here lets the popup re-render the
  // diagnostic on its next open.
  async function persistResult(roleName, mode, r) {
    try {
      await chrome.storage.local.set({
        vrbLastResult: { ...r, roleName, mode, trace: trace.slice() },
        vrbLastResultAt: Date.now(),
      });
    } catch (_) {}
  }
  // Debug output goes to the Verint page's DevTools console (right-click the
  // page → Inspect → Console, filter "[VRB]"). The in-memory `trace` is still
  // attached to the response object so popup-side persistence (vrbLastResult)
  // can surface diagnostics that survive the native unsaved-changes dialog.
  const log = (...a) => {
    const line =
      new Date().toISOString().slice(11, 23) +
      " " +
      a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ");
    trace.push(line);
    try { console.log("[VRB]", line); } catch (_) {}
  };

  // ---- frame access -------------------------------------------------------
  const topMctnt = () => document.querySelector("iframe#mctnt");
  function mctntDoc() {
    const f = topMctnt();
    return f && f.contentDocument;
  }
  function paneDoc(id) {
    const md = mctntDoc();
    if (!md) return null;
    const f = md.querySelector("#" + id);
    return (f && f.contentDocument) || null;
  }
  const rightDoc = () => paneDoc("oRightPaneContent");
  const leftDoc = () => paneDoc("oLeftPaneContent");

  // Robust detection: the `iframe#mctnt` whose src is the role_setup_fs
  // legacy workspace is unique to this page, OR the right-pane inner doc shows
  // the Role List / Role Setup Form. Title/hash vary with menu navigation,
  // locale and encoding, so they are diagnostics only — not gating.
  function pageInfo() {
    const f = topMctnt();
    const mctntSrc = f ? f.src || "" : "";
    const okFrame = !!f && /role_setup_fs/.test(mctntSrc);
    let innerTitle = "";
    try {
      innerTitle = rightDoc().title || "";
    } catch (_) {}
    const okInner = /Role (List|Setup Form)/i.test(innerTitle);
    return {
      onPage: okFrame || okInner,
      title: document.title,
      hash: (location.hash || "").slice(0, 140),
      hasMctnt: !!f,
      mctntSrc: mctntSrc.slice(0, 140),
      innerTitle,
    };
  }
  const isRolesSetup = () => pageInfo().onPage;

  function selectedOrg() {
    const L = leftDoc();
    if (!L) return null;
    const n = L.querySelector('tr[aria-selected="true"]');
    return n ? n.textContent.trim() : null;
  }

  // grid row cells (recon order): 0 Default, 1 IsAdmin, 2 Desc, 3 OwnerOrg, 4 Modules
  function gridRows(roleName) {
    const R = rightDoc();
    if (!R) return [];
    return [...R.querySelectorAll("tr[itemname]")].filter(
      (tr) => tr.getAttribute("itemname") === roleName
    );
  }

  function rowInfo(tr) {
    const td = [...tr.querySelectorAll("td")].map((x) => x.textContent.trim());
    return {
      isDefault: td[0] === "Yes",
      isAdmin: td[1] === "Yes",
      ownerOrg: td[3] || "",
    };
  }

  // ---- waits --------------------------------------------------------------
  async function waitFor(fn, { timeoutMs = 20000, every = 250 } = {}) {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const v = fn();
        if (v) return v;
      } catch (_) {}
      await sleep(every);
    }
    return null;
  }
  const waitForm = () =>
    waitFor(() => {
      const R = rightDoc();
      return R && /Role Setup Form/.test(R.title) && E.listChecks(R).length
        ? R
        : null;
    });
  function fire(el, types) {
    const view = el.ownerDocument.defaultView;
    for (const t of types)
      el.dispatchEvent(
        new MouseEvent(t, { bubbles: true, cancelable: true, view })
      );
  }

  // ---- message handlers ---------------------------------------------------
  async function getContext({ roleName }) {
    trace = []; // start of a role run (getContext -> apply share one trace)
    if (!isRolesSetup()) return { error: "not_on_roles_setup" };
    const org = selectedOrg();
    if (!org) return { error: "no_org_selected" };
    const rd = rightDoc();
    const rows = gridRows(roleName);
    const match = rows.map(rowInfo).find((r) => r.ownerOrg === org);
    log("getContext", {
      roleName,
      rightTitle: rd && rd.title,
      totalRows: rd ? rd.querySelectorAll("tr[itemname]").length : -1,
      nameRows: rows.length,
      exists: !!match,
    });
    return {
      ownerOrg: org,
      anyNameRow: rows.length > 0,
      exists: !!match,
      isDefault: match ? match.isDefault : false,
      isAdmin: match ? match.isAdmin : false,
    };
  }

  function progress(p) {
    try {
      chrome.runtime.sendMessage({ type: VRB.MSG.PROGRESS, ...p });
    } catch (_) {}
  }

  async function openEditor(roleName) {
    const rd0 = rightDoc();
    log("openEditor", { roleName, beforeTitle: rd0 && rd0.title });
    const tr = gridRows(roleName)[0];
    if (!tr) throw new Error("Role row vanished before edit.");
    tr.scrollIntoView();
    fire(tr, ["mousedown", "mouseup", "click", "mousedown", "mouseup", "click", "dblclick"]);
    const R = await waitForm();
    if (!R) throw new Error("Editor did not open.");
    return R;
  }

  async function openCreate(roleName, description) {
    const R0 = rightDoc();
    const add = R0 && R0.querySelector("#toolbar_ADD_ACTIONLabel");
    if (!add) throw new Error("Create Role button not found.");
    fire(add, ["mousedown", "mouseup", "click"]);
    const R = await waitForm();
    if (!R) throw new Error("Create form did not open.");
    const setVal = (sel, v) => {
      const el = R.querySelector(sel);
      if (el) {
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
    };
    setVal('input[name="roleName"]', roleName);
    setVal('input[name="description"]', description);
    // isAdminRole left unchecked by spec
    return R;
  }

  function clickToolbar(R, id) {
    const b = R && R.querySelector("#" + id);
    if (!b) return false;
    fire(b, ["mousedown", "mouseup", "click"]);
    return true;
  }

  // grid is back AND the form is gone (a real, settled transition)
  const gridBack = () =>
    waitFor(
      () => {
        const R = rightDoc();
        return R && /Role List/.test(R.title) && R.querySelector("tr[itemname]")
          ? R
          : null;
      },
      { timeoutMs: 15000 }
    );

  // Discard a (possibly dirty) form via Verint's own Cancel button. LAB-
  // instrumented: clicking Cancel cleanly discards a dirty form with NO
  // unsaved-changes prompt. Verint's "changes will not be saved" guard is a
  // *native* confirm()/beforeunload (proven via the delete confirm) — a
  // content script CANNOT auto-dismiss it. The only robust protection is
  // never to navigate away from a dirty/unsettled form: always Cancel here
  // or commit via saveCommit(), then wait for gridBack(), before any reopen.
  async function cancelForm(R) {
    if (!R) {
      log("cancelForm: no doc");
      return;
    }
    const a = clickToolbar(R, "workpaneMediator_toolbar_CANCEL_ACTIONLabel");
    const b = a || clickToolbar(R, "CANCEL_ACTION_id");
    log("cancelForm clicked", { btn: a, td: !a && b, title: R.title });
    await sleep(300);
  }

  // Commit and confirm it actually took (grid returns / form closes). Re-
  // resolves the Save element each attempt and falls back BUTTON -> TD,
  // because the toolbar mediator is rebuilt on a re-entered editor.
  async function saveCommit() {
    for (const id of ["workpaneMediator_toolbar_SAVE_ACTIONLabel", "SAVE_ACTION_id"]) {
      const R = rightDoc();
      const found = !!(R && R.querySelector("#" + id));
      log("saveCommit attempt", { id, found, titleBefore: R && R.title });
      if (!found) continue;
      clickToolbar(R, id);
      await sleep(800);
      const rd = rightDoc();
      log("saveCommit post-click", {
        title: rd && rd.title,
        rows: rd ? rd.querySelectorAll("tr[itemname]").length : -1,
      });
      if (await gridBack()) {
        log("saveCommit committed via", id);
        return { ok: true };
      }
      log("saveCommit gridBack timeout for", id);
    }
    return { ok: false, reason: "save_not_committed" };
  }

  async function apply({ mode, roleName, description, yesIds, masterIds }) {
    if (!isRolesSetup()) return { error: "not_on_roles_setup" };
    const yesSet = new Set(yesIds);
    const masterSet = new Set(masterIds);
    log("apply start", {
      mode,
      roleName,
      yesCount: yesSet.size,
      masterCount: masterSet.size,
    });

    let R =
      mode === "create"
        ? await openCreate(roleName, description)
        : await openEditor(roleName);
    log("form open", { title: R && R.title });

    progress({ phase: "tree" });
    const res = await E.applyStrictMirror(R, yesSet, masterSet, progress);
    log("applyStrictMirror done", {
      changed: res.changed,
      mismatches: res.mismatches.length,
      skippedAbsent: res.skippedAbsent.length,
      skippedDisabled: (res.skippedDisabled || []).length,
      skippedNonMaster: (res.skippedNonMaster || []).length,
    });

    // Idempotent edit: nothing was toggled and the role already matches the
    // CSV exactly — the form is not dirty, so discard it; nothing to save.
    if (mode === "edit" && res.changed === 0 && res.mismatches.length === 0) {
      log("-> no-op edit (already exact): cancel + return");
      const out = {
        ok: true,
        changed: 0,
        saved: false,
        verify: "already-exact",
        skippedAbsent: res.skippedAbsent,
        skippedNonMaster: res.skippedNonMaster || [],
      };
      await persistResult(roleName, mode, out);
      await cancelForm(R);
      await gridBack();
      return out;
    }

    // Transactional gate: final authoritative verify scan before Save.
    const finalMiss = E.mismatchList(R, yesSet, masterSet);
    log("pre-save verify", { mismatches: finalMiss.length });

    if (finalMiss.length) {
      // Verify FAILED — never write a wrong or partial role. Persist the
      // diagnostic BEFORE Cancel: a dirty-form Cancel triggers Verint's
      // native "changes will not be saved" confirm, which closes the popup;
      // storage survives that so the popup can re-render on next open.
      log("-> verify failed: rollback, no save", finalMiss.length);
      const out = {
        ok: false,
        reason:
          mode === "create"
            ? "verify_failed_role_not_created"
            : "verify_failed_role_unchanged",
        rolledBack: true,
        saved: false,
        changed: res.changed,
        skippedAbsent: res.skippedAbsent,
        skippedDisabled: res.skippedDisabled || [],
        skippedNonMaster: res.skippedNonMaster || [],
        mismatches: finalMiss.slice(0, 50),
      };
      await persistResult(roleName, mode, out);
      await cancelForm(R);
      await gridBack();
      return out;
    }

    progress({ phase: "save" });
    const committed = await saveCommit();
    log("saveCommit result", committed);
    if (!committed.ok) {
      // Save did not take — roll back so we never leave a dirty form (that is
      // what trips Verint's unsaved-changes guard on the next navigation).
      log("-> save failed: rollback + return", committed.reason);
      const out = {
        ok: false,
        reason: "save_not_committed",
        rolledBack: true,
        saved: false,
        skippedAbsent: res.skippedAbsent,
        skippedNonMaster: res.skippedNonMaster || [],
      };
      await persistResult(roleName, mode, out);
      await cancelForm(rightDoc());
      await gridBack();
      return out;
    }

    // Commit confirmed (grid returned) AND every checkbox verified exact
    // before the Save click — a true transactional success.
    log("-> committed, verified exact");
    const out = {
      ok: true,
      changed: res.changed,
      saved: true,
      verify: "verified-exact",
      skippedAbsent: res.skippedAbsent,
      skippedDisabled: res.skippedDisabled || [],
      skippedNonMaster: res.skippedNonMaster || [],
      mismatches: [],
    };
    await persistResult(roleName, mode, out);
    return out;
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg.type === VRB.MSG.CHECK_PAGE)
          return sendResponse(pageInfo());
        if (msg.type === VRB.MSG.GET_CONTEXT)
          return sendResponse(await getContext(msg));
        if (msg.type === VRB.MSG.APPLY) {
          let r;
          try {
            r = await apply(msg);
          } catch (e) {
            log("apply threw", String((e && e.message) || e));
            r = { error: String((e && e.message) || e) };
          }
          if (r && typeof r === "object") r.trace = trace.slice();
          return sendResponse(r);
        }
        sendResponse({ error: "unknown_message" });
      } catch (e) {
        sendResponse({ error: String((e && e.message) || e), trace: trace.slice() });
      }
    })();
    return true; // async response
  });
})(typeof self !== "undefined" ? self : this);
