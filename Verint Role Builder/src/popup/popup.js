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
    ["report", "pickStep", "confirm", "status", "exportStep"].forEach((i) =>
      show(i, false)
    );
    $("file").value = "";
  }

  // Back to the mode-select screen from either the upload step or the export
  // step. Used by exportCancel and after a successful export.
  function backToMode() {
    ["uploadStep", "exportStep", "report", "status"].forEach((i) =>
      show(i, false)
    );
    show("modeStep", true);
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
    const v = VRB.validateStructure(uploaded, state.master, f.name);
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

    const sel = $("role");
    sel.innerHTML = "";
    v.roles.forEach((r) => {
      const o = document.createElement("option");
      o.value = r.colIdx;
      o.textContent = r.name;
      sel.appendChild(o);
    });
    // target-name input: defaults to the selected source name; follows the
    // dropdown while the user hasn't edited it themselves (dirty flag).
    state.targetDirty = false;
    $("targetName").value = v.roles[0] ? v.roles[0].name : "";
    show("targetNameErr", false);
    show("pickStep", true);
  }

  function onRoleChange() {
    if (!state.targetDirty) {
      const opt = $("role").selectedOptions[0];
      $("targetName").value = opt ? opt.textContent : "";
    }
  }
  function onTargetInput() {
    state.targetDirty = true;
    show("targetNameErr", false);
  }

  async function onContinue() {
    const colIdx = parseInt($("role").value, 10);
    const sourceRoleName = $("role").selectedOptions[0].textContent;
    const targetRoleName = $("targetName").value.trim();
    if (!targetRoleName) {
      const e = $("targetNameErr");
      e.textContent = "Enter a target role name.";
      show("targetNameErr", true);
      return;
    }
    show("pickStep", false);

    const ctx = await sendTab({ type: VRB.MSG.GET_CONTEXT, roleName: targetRoleName });
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
      if (!(await ask(`Overwrite role "${targetRoleName}" under "${ctx.ownerOrg}"?`)))
        return reset();
      if (ctx.isDefault || ctx.isAdmin) {
        const kind = [ctx.isDefault && "Default", ctx.isAdmin && "Admin"]
          .filter(Boolean)
          .join(" & ");
        if (
          !(await ask(
            `⚠ "${targetRoleName}" is a ${kind} role (high blast radius — affects every assigned user). Overwrite anyway?`
          ))
        )
          return reset();
      }
      mode = "edit";
    } else {
      mode = "create";
    }

    const plan = VRB.buildPlan(state.uploaded, state.master, colIdx);
    // The set of privIds the CSV (and its master) has any opinion on.
    // Anything else live in the form is a non-master extra Verint manages.
    const masterIds = state.master.rows
      .filter((r) => !r.isGroup)
      .map((r) => r.privId);
    const sameName = sourceRoleName === targetRoleName;
    status(
      esc(
        "Mode: " + mode +
        "\nEnable (Yes): " + plan.yesCount +
        (sameName
          ? "\nApplying strict mirror…"
          : `\nApplying "${sourceRoleName}" → "${targetRoleName}"…`)
      )
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
        sourceRoleName,
        targetRoleName,
        description: targetRoleName,
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
      const src = vrbLastResult.sourceRoleName;
      const tgt = vrbLastResult.targetRoleName || vrbLastResult.roleName || "?";
      const mode = vrbLastResult.mode || "?";
      const label =
        src && src !== tgt
          ? `"${src}" → "${tgt}"`
          : `"${tgt}"`;
      report(
        '<i>Last run · ' +
          esc(stamp) +
          ' · ' +
          esc(mode) +
          ' ' +
          esc(label) +
          '</i>',
        ""
      );
      renderResult(vrbLastResult);
    } catch (_) {}
  }

  // Export/Import mode buttons — both gate on the cached page recon. If not
  // on Roles Setup, surface the single-line precondition and stay on the mode
  // step. Each click also re-fires the recon so a user who navigates while
  // the popup is open can retry without reopening it.
  async function onExportClick() {
    reconPageSilent();
    if (!pageOk()) return reportNotOnRolesSetup();
    show("report", false);
    show("status", false);
    status("<i>Loading roles…</i>");
    const res = await sendTab({ type: VRB.MSG.LIST_ROLES });
    if (res.error) {
      show("status", false);
      report('<span class="err">Error: ' + esc(res.error) + "</span>", "err");
      return;
    }
    if (!res.roles || !res.roles.length) {
      show("status", false);
      report('<span class="warn">No roles on this page.</span>', "warn");
      return;
    }
    show("status", false);
    const sel = $("exportRole");
    sel.innerHTML = "";
    res.roles.forEach((name) => {
      const o = document.createElement("option");
      o.value = name;
      o.textContent = name;
      sel.appendChild(o);
    });
    show("modeStep", false);
    show("exportStep", true);
  }

  async function onExportConfirm() {
    const roleName = $("exportRole").value;
    if (!roleName) return;
    show("exportStep", false);
    show("report", false);
    status('<i>Opening editor for "' + esc(roleName) + '"…</i>');

    const res = await sendTab({
      type: VRB.MSG.EXPORT_READ,
      roleName,
    });
    if (res.error) {
      status(
        '<span class="err">Export failed: ' + esc(res.error) + "</span>",
        "err"
      );
      show("exportStep", true); // let the user retry / pick another role
      return;
    }

    const enabledSet = new Set(res.enabledIds || []);
    const csv = VRB.buildExportCsv(state.master, roleName, enabledSet);
    const filename = VRB.exportFilename(roleName);
    // Use a base64 data URL (not a blob URL) so the download is independent
    // of the popup's life cycle. The Save-As dialog steals focus and tears
    // the popup down; a blob URL would 404 once that happens. CSV is small
    // (~30 KB); base64 overhead is irrelevant. UTF-8 preserved via
    // FileReader.readAsDataURL.
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const dataUrl = await new Promise((resolve, reject) => {
      const fr = new FileReader();
      fr.onload = () => resolve(fr.result);
      fr.onerror = () => reject(fr.error || new Error("FileReader failed"));
      fr.readAsDataURL(blob);
    });
    // Trigger the download from the background SW — calling
    // chrome.downloads.download with saveAs:true from the popup honored the
    // hint on the first run only (popup teardown on focus-loss dropped the
    // option on subsequent runs, so the file went silently to Downloads).
    // The SW outlives the popup, so saveAs:true is honored every time.
    const out = await bg({ bg: "download", dataUrl, filename });
    if (out && out.ok) {
      status(
        '<span class="ok">✅ Export ready — choose a destination in the browser dialog.</span>\n' +
          esc(filename),
        "ok"
      );
    } else {
      status(
        '<span class="err">Download failed: ' +
          esc((out && out.error) || "unknown") +
          "</span>",
        "err"
      );
      show("exportStep", true);
    }
  }

  function onExportCancel() {
    backToMode();
  }

  function onImportClick() {
    reconPageSilent();
    if (!pageOk()) return reportNotOnRolesSetup();
    show("report", false);
    show("modeStep", false);
    show("uploadStep", true);
    $("file").click();
  }

  // Native file-picker dismissal (Chrome dispatches `cancel` when the user
  // closes the dialog without picking). Return to the mode-select screen so
  // the user can choose Export or Import again without reopening the popup.
  function onFileCancel() {
    if (!$("file").files.length) backToMode();
  }

  $("exportBtn").addEventListener("click", onExportClick);
  $("importBtn").addEventListener("click", onImportClick);
  $("exportConfirmBtn").addEventListener("click", onExportConfirm);
  $("exportCancelBtn").addEventListener("click", onExportCancel);
  $("file").addEventListener("click", onUploadClick);
  $("file").addEventListener("change", onFile);
  $("file").addEventListener("cancel", onFileCancel);
  $("role").addEventListener("change", onRoleChange);
  $("targetName").addEventListener("input", onTargetInput);
  $("continueBtn").addEventListener("click", onContinue);
  $("cancelBtn").addEventListener("click", reset);
  loadMaster();
  reconPageSilent();
  showLastResult();
})();
