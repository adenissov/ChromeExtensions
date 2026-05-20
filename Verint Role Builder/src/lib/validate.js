// Structural validation of an uploaded multi-role config CSV against the
// embedded master, plus per-role plan building (Yes set + auto-promote).
// Uploaded schema: NLine, PrivilegeName, Module, <role columns...>
// [, PrivilegeDescription]. Validate NLine + PrivilegeName + Module in exact
// order vs master; PrivilegeDescription is optional and NOT validated.
(function (root) {
  const VRB = (root.VRB = root.VRB || {});
  const ERR_CAP = 50;

  function validateStructure(uploaded, master, fileName) {
    const errors = [];
    const tag = fileName ? `[${fileName}] ` : "";
    const push = (m) => {
      if (errors.length < ERR_CAP) errors.push(tag + m);
    };
    const H = uploaded.header.map((h) => h);

    if (H[0] !== "NLine" || H[1] !== "PrivilegeName" || H[2] !== "Module")
      return fail("Header must start with NLine, PrivilegeName, Module (in that order), followed by one or more role columns.");
    const iNLine = 0, iName = 1, iModule = 2;
    const iPD = H.lastIndexOf("PrivilegeDescription");

    if (iPD >= 0 && iPD !== H.length - 1)
      return fail("PrivilegeDescription, if present, must be the last column.");
    const end = iPD >= 0 ? iPD : H.length;
    if (end - iModule < 2)
      return fail("No role columns found after Module.");

    const roleCols = [];
    const seen = new Set();
    for (let c = iModule + 1; c < end; c++) {
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
      cols: { iNLine, iName, iModule },
    };

    function fail(msg) {
      return { ok: false, errors: [tag + msg], roles: [], rowCount: uploaded.rows.length, roleCount: 0 };
    }
  }

  // Build the apply plan for one role column: the exact set of PrivilegeIDs
  // marked "Yes". Verint enables any required parent itself, so no promotion.
  function buildPlan(uploaded, master, colIdx) {
    const yes = new Set();
    for (let i = 0; i < master.rows.length; i++) {
      const m = master.rows[i];
      if (m.isGroup) continue;
      if (uploaded.rows[i][colIdx] === "Yes") yes.add(m.privId);
    }
    return { yesIds: [...yes], yesCount: yes.size };
  }

  VRB.validateStructure = validateStructure;
  VRB.buildPlan = buildPlan;
})(typeof self !== "undefined" ? self : this);
