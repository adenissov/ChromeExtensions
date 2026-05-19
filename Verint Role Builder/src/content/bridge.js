// Orchestrator content script (top frame of the Verint tab). All Roles Setup
// frames are same-origin, so we reach the nested panes via contentDocument
// (exactly as the recon evals did). Selectors: see dev/recon/create-dialog-recon.md.
(function (root) {
  const VRB = (root.VRB = root.VRB || {});
  const E = VRB.engine;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const FORM_TITLE = "Verint - User Management: Security: Role Setup Form";

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

  function isRolesSetup() {
    const f = topMctnt();
    const okFrame = !!f && /control\/role_setup_fs/.test(f.src || "");
    const okTitle = document.title === VRB.PAGE_TITLE;
    const okHash =
      /selTab=1_USER_MANAGEMENT(->|-%3E)2_SECURITY(->|-%3E)3_BBM_GEN_ROLES/.test(
        location.hash || ""
      );
    return okFrame && (okTitle || okHash);
  }

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
  const waitGrid = () =>
    waitFor(() => {
      const R = rightDoc();
      return R && R.querySelector("tr[itemname]") ? R : null;
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
    if (!isRolesSetup()) return { error: "not_on_roles_setup" };
    const org = selectedOrg();
    if (!org) return { error: "no_org_selected" };
    const rows = gridRows(roleName);
    const match = rows.map(rowInfo).find((r) => r.ownerOrg === org);
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
    const b = R.querySelector("#" + id);
    if (!b) return false;
    fire(b, ["mousedown", "mouseup", "click"]);
    return true;
  }

  async function apply({ mode, roleName, description, yesIds }) {
    if (!isRolesSetup()) return { error: "not_on_roles_setup" };
    const yesSet = new Set(yesIds);

    let R =
      mode === "create"
        ? await openCreate(roleName, description)
        : await openEditor(roleName);

    progress({ phase: "tree" });
    const res = await E.applyStrictMirror(R, yesSet, progress);

    if (res.mismatches.length) {
      clickToolbar(R, "workpaneMediator_toolbar_CANCEL_ACTIONLabel");
      return {
        ok: false,
        reason: "reconcile_failed",
        mismatches: res.mismatches.slice(0, 30),
        skippedAbsent: res.skippedAbsent,
      };
    }

    if (res.changed === 0 && mode === "edit") {
      clickToolbar(R, "workpaneMediator_toolbar_CANCEL_ACTIONLabel");
      return { ok: true, changed: 0, skippedAbsent: res.skippedAbsent, saved: false };
    }

    if (!clickToolbar(R, "workpaneMediator_toolbar_SAVE_ACTIONLabel"))
      return { ok: false, reason: "save_button_missing" };

    progress({ phase: "save" });
    // Post-save UX is observed in Step 3; verify defensively.
    const G = await waitGrid();
    let verify = "unconfirmed";
    if (G) {
      try {
        const R2 = await openEditor(roleName);
        await E.waitReady(R2);
        E.expandTree(R2);
        await sleep(300);
        const enabled = E.readEnabled(R2);
        const want = new Set(yesSet);
        for (const a of res.skippedAbsent) want.delete(a);
        const missing = [...want].filter((id) => !enabled.has(id));
        const extra = [...enabled].filter((id) => !want.has(id));
        verify = missing.length || extra.length ? "mismatch" : "ok";
        clickToolbar(R2, "workpaneMediator_toolbar_CANCEL_ACTIONLabel");
        return {
          ok: verify === "ok",
          changed: res.changed,
          saved: true,
          verify,
          skippedAbsent: res.skippedAbsent,
          missing: missing.slice(0, 30),
          extra: extra.slice(0, 30),
        };
      } catch (e) {
        verify = "unconfirmed:" + e.message;
      }
    }
    return {
      ok: true,
      changed: res.changed,
      saved: true,
      verify,
      skippedAbsent: res.skippedAbsent,
    };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    (async () => {
      try {
        if (msg.type === VRB.MSG.CHECK_PAGE)
          return sendResponse({ onPage: isRolesSetup() });
        if (msg.type === VRB.MSG.GET_CONTEXT)
          return sendResponse(await getContext(msg));
        if (msg.type === VRB.MSG.APPLY) return sendResponse(await apply(msg));
        sendResponse({ error: "unknown_message" });
      } catch (e) {
        sendResponse({ error: String((e && e.message) || e) });
      }
    })();
    return true; // async response
  });
})(typeof self !== "undefined" ? self : this);
