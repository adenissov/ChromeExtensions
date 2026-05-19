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

  function sendTab(msg) {
    return chrome.tabs
      .query({ active: true, currentWindow: true })
      .then(([t]) =>
        t ? chrome.tabs.sendMessage(t.id, msg) : { error: "no_active_tab" }
      )
      .catch((e) => ({ error: String(e.message || e) }));
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

  async function loadMaster() {
    const txt = await fetch(chrome.runtime.getURL(VRB.MASTER_PATH)).then((r) =>
      r.text()
    );
    state.master = VRB.buildMaster(txt);
  }

  async function onFile(ev) {
    const f = ev.target.files[0];
    if (!f) return;
    reset();

    // 1. page precondition — before any parsing
    const pc = await sendTab({ type: VRB.MSG.CHECK_PAGE });
    if (pc.error || !pc.onPage) {
      report(
        '<span class="err">Open User Management → Security → Roles Setup in the active tab, then upload again.</span>',
        "err"
      );
      return;
    }

    // 2. parse + validate
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
    const autoPromote = $("autoPromote").checked;

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

    const plan = VRB.buildPlan(state.uploaded, state.master, colIdx, autoPromote);
    let pre =
      "Mode: " +
      mode +
      "\nEnable (Yes): " +
      plan.rawYesCount +
      (autoPromote
        ? " · auto-promoted parents: " + plan.promoted.length
        : " · downgraded children: " + plan.downgraded.length) +
      "\nApplying strict mirror…";
    status(esc(pre));

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
      });
      renderResult(res, plan);
    } finally {
      await bg({ bg: "release" });
    }
  }

  function renderResult(res, plan) {
    if (res.error || res.ok === false) {
      status(
        '<b class="err">Failed:</b> ' +
          esc(res.reason || res.error || "unknown") +
          (res.mismatches
            ? "\nmismatched: " + res.mismatches.map((m) => m.id).join(", ")
            : ""),
        "err"
      );
      return;
    }
    const lines = [];
    lines.push(res.saved ? "Saved." : "No changes — not saved.");
    lines.push("Changed checkboxes: " + (res.changed || 0));
    if (res.skippedAbsent && res.skippedAbsent.length)
      lines.push(
        "Skipped (no checkbox in this env): " + res.skippedAbsent.length
      );
    if (plan.downgraded && plan.downgraded.length)
      lines.push("Downgraded children (auto-promote off): " + plan.downgraded.length);
    lines.push("Verify: " + (res.verify || "n/a"));
    if (res.missing && res.missing.length)
      lines.push("Verify missing: " + res.missing.join(", "));
    if (res.extra && res.extra.length)
      lines.push("Verify extra: " + res.extra.join(", "));
    status(esc(lines.join("\n")), res.verify === "ok" || !res.saved ? "ok" : "warn");
  }

  $("file").addEventListener("change", onFile);
  $("continueBtn").addEventListener("click", onContinue);
  $("cancelBtn").addEventListener("click", reset);
  loadMaster();
})();
