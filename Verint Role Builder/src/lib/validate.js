// Structural validation of an uploaded multi-role config CSV against the
// embedded master, plus per-role plan building (Yes set + auto-promote).
// Uploaded schema: NLine, PrivilegeName, Module, <role columns...>,
// PrivilegeDescription. Validate NLine + PrivilegeName + Module in exact
// order vs master; PrivilegeDescription is NOT validated.
(function (root) {
  const VRB = (root.VRB = root.VRB || {});
  const ERR_CAP = 50;

  function validateStructure(uploaded, master) {
    const errors = [];
    const push = (m) => {
      if (errors.length < ERR_CAP) errors.push(m);
    };
    const H = uploaded.header.map((h) => h);

    const iNLine = H.indexOf("NLine");
    const iName = H.indexOf("PrivilegeName");
    const iModule = H.indexOf("Module");
    const iPD = H.lastIndexOf("PrivilegeDescription");

    if (iNLine < 0 || iName < 0 || iModule < 0 || iPD < 0)
      return fail("Header must contain NLine, PrivilegeName, Module and PrivilegeDescription.");
    if (!(iNLine < iName && iName < iModule && iModule < iPD))
      return fail("Header columns out of order (expected NLine, PrivilegeName, Module, …roles…, PrivilegeDescription).");
    if (iPD !== H.length - 1)
      return fail("PrivilegeDescription must be the last column.");
    if (iPD - iModule < 2)
      return fail("No role columns found between Module and PrivilegeDescription.");

    const roleCols = [];
    const seen = new Set();
    for (let c = iModule + 1; c < iPD; c++) {
      const name = (H[c] || "").trim();
      if (!name) return fail(`Role column #${c + 1} has an empty header.`);
      if (seen.has(name)) return fail(`Duplicate role column: "${name}".`);
      seen.add(name);
      roleCols.push({ name, colIdx: c });
    }

    if (uploaded.rows.length !== master.rows.length)
      push(
        `Row count ${uploaded.rows.length} ≠ master ${master.rows.length} (NLine is non-contiguous; the master row count is authoritative).`
      );

    const limit = Math.min(uploaded.rows.length, master.rows.length);
    for (let i = 0; i < limit; i++) {
      const up = uploaded.rows[i];
      const m = master.rows[i];
      const ln = `row ${i + 2}`; // +2: 1 header line + 1-based
      if (parseInt(up[iNLine], 10) !== m.nLine)
        push(`${ln}: NLine ${up[iNLine]} ≠ master ${m.nLine}.`);
      if (up[iName] !== m.name)
        push(`${ln}: PrivilegeName mismatch (incl. leading spaces).`);
      if ((up[iModule] ?? "") !== (m.module ?? ""))
        push(`${ln}: Module "${up[iModule]}" ≠ master "${m.module}".`);
      if (!m.isGroup) {
        for (const rc of roleCols) {
          const v = up[rc.colIdx];
          if (v !== "Yes" && v !== "---")
            push(`${ln}: role "${rc.name}" must be Yes or --- (got "${v}").`);
        }
      }
    }

    return {
      ok: errors.length === 0,
      errors,
      roles: roleCols,
      rowCount: uploaded.rows.length,
      roleCount: roleCols.length,
      cols: { iNLine, iName, iModule, iPD },
    };

    function fail(msg) {
      return { ok: false, errors: [msg], roles: [], rowCount: uploaded.rows.length, roleCount: 0 };
    }
  }

  // Build the apply plan for one role column.
  // autoPromote=true: enable required parents. false: downgrade the offending
  // children to disabled and list them.
  function buildPlan(uploaded, master, colIdx, autoPromote) {
    const yes = new Set();
    for (let i = 0; i < master.rows.length; i++) {
      const m = master.rows[i];
      if (m.isGroup) continue;
      if (uploaded.rows[i][colIdx] === "Yes") yes.add(m.privId);
    }
    const { promoted, conflicts } = VRB.computePromotions(master, yes);

    let effective;
    let downgraded = [];
    if (autoPromote) {
      effective = new Set([...yes, ...promoted]);
    } else {
      const offending = new Set(conflicts.map((c) => c.childId));
      effective = new Set([...yes].filter((id) => !offending.has(id)));
      downgraded = [...offending];
    }

    return {
      yesIds: [...effective],
      rawYesCount: yes.size,
      promoted: [...promoted],
      conflicts,
      downgraded,
    };
  }

  VRB.validateStructure = validateStructure;
  VRB.buildPlan = buildPlan;
})(typeof self !== "undefined" ? self : this);
