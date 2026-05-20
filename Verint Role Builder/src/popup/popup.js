// Popup orchestrator. Flow: upload -> page-precondition gate -> validate ->
// role dropdown -> owner-org confirm -> exists/overwrite (+high-risk 2nd) /
// not-found/create -> apply -> result. Every prompt is cancellable.
(function () {
  const VRB = self.VRB;
  const $ = (id) => document.getElementById(id);
  const state = {};

  const show = (id, on = true) => $(id).classList.toggle("hidden", !on);
  function report(html, cls) {
    const r = $("report");
    r.className = cls || "";
    r.innerHTML = html;
    show("report", true);
  }
  function status(html, cls) {
    const s = $("status");
    s.className = cls || "";
    s.innerHTML = html;
    show("status", true);
  }
  const esc = (s) =>
    String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

  const REASONS = {
    verify_failed_role_not_created:
      "Verification failed — the role was NOT created. No partial role written.",
    verify_failed_role_unchanged:
      "Verification failed — the existing role was left UNCHANGED. Nothing overwritten.",
    save_not_committed:
      "Save did not commit — form was rolled back. No changes written.",
    not_on_roles_setup: "Not on the Roles Setup page.",
    no_org_selected: "No organization selected in the left pane.",
  };

  const CONTENT_FILES = [
    "src/lib/protocol.js",
    "src/content/apply.js",
    "src/content/bridge.js",
  ];

  // Send to the content script; if it isn't there (extension reloaded without
  // reloading the Verint tab, or tab opened before install), inject it on
  // demand and retry once.
  async function sendTab(msg) {
    const [t] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!t) return { error: "no_active_tab" };
    try {
      return await chrome.tabs.sendMessage(t.id, msg);
    } catch (_) {
      try {
        await chrome.scripting.executeScript({
          target: { tabId: t.id },
          files: CONTENT_FILES,
        });
      } catch (e) {
        return { error: "inject_failed: " + (e.message || e) };
      }
      try {
        return await chrome.tabs.sendMessage(t.id, msg);
      } catch (e) {
        return { error: String(e.message || e) };
      }
    }
  }
  const bg = (msg) => chrome.runtime.sendMessage(msg);

  // in-popup Yes/No, resolves boolean
  function ask(message) {
    return new Promise((resolve) => {
      $("confirmMsg").textContent = message;
      show("confirm", true);
      const done = (v) => {
        show("confirm", false);
        $("yesBtn").onclick = $("noBtn").onclick = null;
        resolve(v);
      };
      $("yesBtn").onclick = () => done(true);
      $("noBtn").onclick = () => done(false);
    });
  }

  function reset() {
    ["report", "pickStep", "confirm", "status"].forEach((i) => show(i, false));
    $("file").value = "";
  }

  // The page-precondition message used by both Export and Import clicks.
  // Single line per the spec; the diagnostics block stays available for the
  // upload-click gate (defence in depth) when the user reaches that step.
  function reportNotOnRolesSetup() {
    report(
      '<span class="err">For extension to work, open it on the "Roles Setup" page.</span>',
      "err"
    );
  }

  // True iff cached recon confirms the active tab is on Roles Setup. Used by
  // the Export/Import gate; the upload-click gate uses the same cache.
  function pageOk() {
    const pc = state.pageInfo;
    return !!(pc && !pc.error && pc.onPage);
  }

  async function loadMaster() {
    const txt = await fetch(chrome.runtime.getURL(VRB.MASTER_PATH)).then((r) =>
      r.text()
    );
    state.master = VRB.buildMaster(txt);
  }

  // Silently recon the active tab on popup open and cache the result. The
  // upload-button click gate (onUploadClick) uses this cache to decide whether
  // to open the OS file picker or surface "Roles Setup is required" instead.
  async function reconPageSilent() {
    try {
      state.pageInfo = await sendTab({ type: VRB.MSG.CHECK_PAGE });
    } catch (e) {
      state.pageInfo = { error: String((e && e.message) || e) };
    }
  }

  // Capture-phase click handler on the hidden file input: if the active tab
  // isn't Roles Setup, block the OS file picker and tell the user. Runs before
  // the input's default click action, so preventDefault() suppresses it.
  function onUploadClick(ev) {
    const pc = state.pageInfo;
    // Re-fire the recon for the NEXT click — if the user navigates to Roles
    // Setup while the popup is still open, their second click will see fresh
    // state. We don't await; this click decides from the cached pc above.
    reconPageSilent();
    if (!pc) {
      ev.preventDefault();
      report(
        '<span class="err">Still checking the active tab — try again in a moment.</span>',
        "err"
      );
      return;
    }
    if (pc.error) {
      ev.preventDefault();
      report(
        '<span class="err"><b>Roles Setup is required.</b> Couldn’t reach the Verint page (' +
          esc(pc.error) +
          "). Reload the Verint tab, make sure it’s the active tab, then try again.</span>",
        "err"
      );
      return;
    }
    if (!pc.onPage) {
      ev.preventDefault();
      report(
        '<span class="err"><b>Roles Setup is required.</b> Open User Management → Security → Roles Setup, then click Upload again.</span>\n\n' +
          "diagnostics:\n" +
          esc(
            JSON.stringify(
              {
                hasMctnt: pc.hasMctnt,
                mctntSrc: pc.mctntSrc,
                innerTitle: pc.innerTitle,
                title: pc.title,
                hash: pc.hash,
              },
              null,
              1
            )
          ),
        "err"
      );
      return;
    }
    // On page — let the file picker open. Clear any prior error report.
    show("report", false);
  }

  async function onFile(ev) {
    const f = ev.target.files[0];
    if (!f) return;
    reset();

    // parse + validate
    const text = await f.text();
    const uploaded = VRB.parseCSV(text);
    const v = VRB.validateStructure(uploaded, state.master);
    state.uploaded = uploaded;
    state.v = v;

    if (!v.ok) {
      report(
        '<b class="err">Validation failed (' +
          v.errors.length +
          ' issue(s)):</b>\n' +
          v.errors.map(esc).join("\n"),
        "err"
      );
      return;
    }
    report(
      '<b class="ok">Structure OK.</b>\nRows: ' +
        v.rowCount +
        " · Roles: " +
        v.roleCount,
      "ok"
    );

    const sel = $("role");
    sel.innerHTML = "";
    v.roles.forEach((r) => {
      const o = document.createElement("option");
      o.value = r.colIdx;
      o.textContent = r.name;
      sel.appendChild(o);
    });
    show("pickStep", true);
  }

  async function onContinue() {
    show("pickStep", false);
    const colIdx = parseInt($("role").value, 10);
    const roleName = $("role").selectedOptions[0].textContent;

    const ctx = await sendTab({ type: VRB.MSG.GET_CONTEXT, roleName });
    if (ctx.error === "no_org_selected") {
      status('<span class="err">Select an organization in the Roles Setup left pane first.</span>', "err");
      return;
    }
    if (ctx.error) {
      status('<span class="err">Error: ' + esc(ctx.error) + "</span>", "err");
      return;
    }

    if (!(await ask(`Owner organization is "${ctx.ownerOrg}". Continue?`)))
      return reset();

    let mode;
    if (ctx.exists) {
      if (!(await ask(`Overwrite role "${roleName}" under "${ctx.ownerOrg}"?`)))
        return reset();
      if (ctx.isDefault || ctx.isAdmin) {
        const kind = [ctx.isDefault && "Default", ctx.isAdmin && "Admin"]
          .filter(Boolean)
          .join(" & ");
        if (
          !(await ask(
            `⚠ "${roleName}" is a ${kind} role (high blast radius — affects every assigned user). Overwrite anyway?`
          ))
        )
          return reset();
      }
      mode = "edit";
    } else {
      if (
        !(await ask(
          `Role "${roleName}" not found under "${ctx.ownerOrg}" — create it?`
        ))
      )
        return reset();
      mode = "create";
    }

    const plan = VRB.buildPlan(state.uploaded, state.master, colIdx);
    // The set of privIds the CSV (and its master) has any opinion on.
    // Anything else live in the form is a non-master extra Verint manages.
    const masterIds = state.master.rows
      .filter((r) => !r.isGroup)
      .map((r) => r.privId);
    status(
      esc("Mode: " + mode + "\nEnable (Yes): " + plan.yesCount + "\nApplying strict mirror…")
    );

    const lock = await bg({ bg: "acquire" });
    if (!lock.ok) {
      status('<span class="err">Another apply is already running.</span>', "err");
      return;
    }
    try {
      const res = await sendTab({
        type: VRB.MSG.APPLY,
        mode,
        roleName,
        description: roleName,
        yesIds: plan.yesIds,
        masterIds,
      });
      renderResult(res);
    } finally {
      await bg({ bg: "release" });
    }
  }

  // element id ("-10399") -> "View Risk Management (-10399)" via embedded master
  function privLabel(id) {
    const m =
      state.master &&
      state.master.rows.find((r) => r.privId === parseInt(id, 10));
    return m ? `${m.name.trim()} (${id})` : String(id);
  }

  function renderResult(res) {
    if (res.error || res.ok === false) {
      const head =
        REASONS[res.reason] || res.reason || res.error || "unknown error";
      const extra = [];
      if (res.rolledBack)
        extra.push(
          "Rolled back cleanly — Verint state untouched. (Verint shows a native " +
            "“changes will not be saved” prompt during rollback — that's expected; " +
            "click OK to dismiss. The popup closes when the prompt appears; reopen " +
            "it to see this diagnostic.)"
        );
      if (res.mismatches && res.mismatches.length)
        extra.push(
          "Privileges still off-target (" +
            res.mismatches.length +
            "):\n  " +
            res.mismatches
              .map((m) => `${privLabel(m.id)} → wanted ${m.want ? "ON" : "OFF"}`)
              .join("\n  ")
        );
      if (res.skippedAbsent && res.skippedAbsent.length)
        extra.push(
          "CSV Yes with no checkbox in this env: " + res.skippedAbsent.length
        );
      if (res.skippedNonMaster && res.skippedNonMaster.length)
        extra.push(
          "Live extras outside the master CSV (left to Verint): " +
            res.skippedNonMaster.length
        );
      status(
        '<b class="err">❌ Failed.</b> ' +
          esc(head) +
          (extra.length ? "\n" + esc(extra.join("\n")) : ""),
        "err"
      );
      return;
    }
    const lines = [];
    lines.push(
      res.verify === "already-exact"
        ? "Role already matched the CSV exactly — nothing to save."
        : "✅ Role saved and verified exact."
    );
    lines.push("Changed checkboxes: " + (res.changed || 0));
    if (res.skippedAbsent && res.skippedAbsent.length)
      lines.push(
        "CSV Yes with no checkbox in this env (informational): " +
          res.skippedAbsent.length
      );
    if (res.skippedNonMaster && res.skippedNonMaster.length)
      lines.push(
        "Live extras outside the master CSV (left to Verint): " +
          res.skippedNonMaster.length
      );
    if (res.skippedDisabled && res.skippedDisabled.length)
      lines.push(
        "Verint-disabled, left as-is: " +
          res.skippedDisabled.map(privLabel).join(", ")
      );
    const clean = !(res.skippedAbsent && res.skippedAbsent.length);
    status(esc(lines.join("\n")), clean ? "ok" : "warn");
  }

  // Re-render the most recent run's outcome on popup open — the popup is
  // closed by Verint's native "discard changes?" confirm during rollback, so
  // we persist the result to chrome.storage.local before that point and
  // restore it here.
  async function showLastResult() {
    try {
      const { vrbLastResult, vrbLastResultAt } = await chrome.storage.local.get([
        "vrbLastResult",
        "vrbLastResultAt",
      ]);
      if (!vrbLastResult) return;
      const stamp = vrbLastResultAt
        ? new Date(vrbLastResultAt).toLocaleTimeString()
        : "?";
      const role = vrbLastResult.roleName || "?";
      const mode = vrbLastResult.mode || "?";
      report(
        '<i>Last run · ' +
          esc(stamp) +
          ' · ' +
          esc(mode) +
          ' "' +
          esc(role) +
          '"</i>',
        ""
      );
      renderResult(vrbLastResult);
    } catch (_) {}
  }

  // Export/Import mode buttons — both gate on the cached page recon. If not
  // on Roles Setup, surface the single-line precondition and stay on the mode
  // step. Each click also re-fires the recon so a user who navigates while
  // the popup is open can retry without reopening it.
  function onExportClick() {
    reconPageSilent();
    if (!pageOk()) return reportNotOnRolesSetup();
    show("report", false);
    status('<i>Export — not implemented yet.</i>', "warn");
  }
  function onImportClick() {
    reconPageSilent();
    if (!pageOk()) return reportNotOnRolesSetup();
    show("report", false);
    show("modeStep", false);
    show("uploadStep", true);
  }

  $("exportBtn").addEventListener("click", onExportClick);
  $("importBtn").addEventListener("click", onImportClick);
  $("file").addEventListener("click", onUploadClick);
  $("file").addEventListener("change", onFile);
  $("continueBtn").addEventListener("click", onContinue);
  $("cancelBtn").addEventListener("click", reset);
  loadMaster();
  reconPageSilent();
  showLastResult();
})();
