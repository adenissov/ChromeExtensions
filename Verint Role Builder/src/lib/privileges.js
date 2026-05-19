// Embedded master model + hierarchy. Master schema:
// NLine, PrivilegeID, ModuleName, PrivilegeName  (PrivilegeID==0 => group row,
// no checkbox). NLine is non-contiguous by design (445 absent) — never assume
// 1..N. Depth = count of leading spaces in PrivilegeName (4 per level).
(function (root) {
  const VRB = (root.VRB = root.VRB || {});

  function leadingSpaces(s) {
    let k = 0;
    while (k < s.length && s[k] === " ") k++;
    return k;
  }

  // master text -> { rows, byNLine, parentOf }
  // rows: [{ nLine, privId, module, name, depth, isGroup, idx }]
  function buildMaster(masterText) {
    const { header, rows: raw } = VRB.parseCSV(masterText);
    const ci = {
      nLine: header.indexOf("NLine"),
      privId: header.indexOf("PrivilegeID"),
      module: header.indexOf("ModuleName"),
      name: header.indexOf("PrivilegeName"),
    };
    const rows = raw.map((r, idx) => {
      const name = r[ci.name];
      const privId = parseInt(r[ci.privId], 10);
      return {
        idx,
        nLine: parseInt(r[ci.nLine], 10),
        privId: Number.isNaN(privId) ? 0 : privId,
        module: r[ci.module] ?? "",
        name,
        depth: leadingSpaces(name),
        isGroup: !privId || privId === 0,
      };
    });

    const byNLine = new Map(rows.map((x) => [x.nLine, x]));

    // Enabling parent of a checkbox row = nearest preceding row with
    // privId!=0 and strictly fewer leading spaces (group rows are skipped as
    // enabling parents but still establish depth).
    const parentOf = new Map();
    for (let k = 0; k < rows.length; k++) {
      const cur = rows[k];
      if (cur.isGroup) continue;
      for (let j = k - 1; j >= 0; j--) {
        const p = rows[j];
        if (!p.isGroup && p.depth < cur.depth) {
          parentOf.set(cur.privId, p.privId);
          break;
        }
      }
    }

    return { header, rows, byNLine, parentOf };
  }

  // Given the set of PrivilegeIDs the chosen role marks "Yes", climb each
  // one's enabling-parent chain and collect parents not already Yes.
  // Returns { promoted:Set<int>, conflicts:[{childId, parentId}] }.
  function computePromotions(master, yesIds) {
    const promoted = new Set();
    const conflicts = [];
    for (const id of yesIds) {
      let pid = master.parentOf.get(id);
      while (pid !== undefined) {
        if (!yesIds.has(pid) && !promoted.has(pid)) {
          promoted.add(pid);
          conflicts.push({ childId: id, parentId: pid });
        }
        pid = master.parentOf.get(pid);
      }
    }
    return { promoted, conflicts };
  }

  VRB.leadingSpaces = leadingSpaces;
  VRB.buildMaster = buildMaster;
  VRB.computePromotions = computePromotions;
})(typeof self !== "undefined" ? self : this);
