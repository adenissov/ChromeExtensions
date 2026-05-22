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

    // Partition by NLine prefix: E-rows (Secure Fields) vs privilege rows.
    // Keep each row's ORIGINAL index so error line numbers stay accurate
    // (origIdx + 2: 1 header line + 1-based). The E-section is OPTIONAL.
    const eRows = [];
    const privRows = [];
    for (let i = 0; i < uploaded.rows.length; i++) {
      const r = uploaded.rows[i];
      if (!(r[iNLine] || "").trim()) continue; // blank separator row
      (/^E\d+$/i.test(r[iNLine]) ? eRows : privRows).push({ r, origIdx: i });
    }

    if (privRows.length !== master.rows.length)
      push(
        `Privilege row count ${privRows.length} ≠ master ${master.rows.length} (NLine is non-contiguous; the master row count is authoritative).`
      );

    const limit = Math.min(privRows.length, master.rows.length);
    for (let i = 0; i < limit; i++) {
      const { r: up, origIdx } = privRows[i];
      const m = master.rows[i];
      const ln = `row ${origIdx + 2}`;
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

    // Secure-fields (E) rows are applied independently, so the ONLY check is
    // that each PrivilegeName resolves to a known secure field
    // ("<label> (View)" / "<label> (Edit)"). Any subset is allowed (missing
    // rows are fine) and cell values are NOT validated — on apply anything
    // other than "Yes" clears the box.
    if (eRows.length) {
      const sf = master.secureFields;
      if (!sf || !sf.byLabel) {
        push(`Secure-fields (E) rows present but the secure-fields master is not loaded.`);
      } else {
        for (const { r: up, origIdx } of eRows) {
          const mm = /^(.*) \((View|Edit)\)$/.exec(up[iName] || "");
          if (!mm || !sf.byLabel.has(mm[1]))
            push(`row ${origIdx + 2}: unknown secure field PrivilegeName "${up[iName]}".`);
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
  // marked "Yes" (privilege rows), plus the secure-fields View/Edit plan
  // (E-rows). Verint enables any required parent itself, so no promotion.
  // E-rows may be interleaved (they're placed first), so partition before the
  // positional join against the master.
  function buildPlan(uploaded, master, colIdx) {
    const iName = 1;
    const eRows = [];
    const privRows = [];
    for (const r of uploaded.rows) {
      if (!(r[0] || "").trim()) continue; // blank separator row
      (/^E\d+$/i.test(r[0]) ? eRows : privRows).push(r);
    }

    const yes = new Set();
    for (let i = 0; i < master.rows.length; i++) {
      const m = master.rows[i];
      if (m.isGroup) continue;
      if (privRows[i] && privRows[i][colIdx] === "Yes") yes.add(m.privId);
    }

    // One entry per PRESENT E-row → set/clear exactly that checkbox on apply;
    // rows absent from the CSV are left untouched. Unknown/unparseable names
    // are skipped here (validateStructure already flags them as errors).
    const sfPlan = [];
    const byLabel = master.secureFields && master.secureFields.byLabel;
    if (byLabel) {
      for (const r of eRows) {
        const mm = /^(.*) \((View|Edit)\)$/.exec(r[iName] || "");
        if (!mm) continue;
        const sfid = byLabel.get(mm[1]);
        if (sfid == null) continue;
        sfPlan.push({ sfid, kind: mm[2].toLowerCase(), want: r[colIdx] === "Yes" });
      }
    }

    return {
      yesIds: [...yes],
      yesCount: yes.size,
      secureFieldsPlan: sfPlan,
    };
  }

  VRB.validateStructure = validateStructure;
  VRB.buildPlan = buildPlan;
})(typeof self !== "undefined" ? self : this);
