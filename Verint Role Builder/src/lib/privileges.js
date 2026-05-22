// Embedded master model. Schema: NLine, PrivilegeID, ModuleName,
// PrivilegeName  (PrivilegeID==0 => group/section header row, no checkbox).
// NLine is non-contiguous by design (445 absent) — never assume 1..N.
// No parent/child handling: Verint's own UI enables required parents when a
// child is enabled.
(function (root) {
  const VRB = (root.VRB = root.VRB || {});

  // master text -> { header, rows, byNLine }
  // rows: [{ idx, nLine, privId, module, name, isGroup }]
  function buildMaster(masterText) {
    const { header, rows: raw } = VRB.parseCSV(masterText);
    const ci = {
      nLine: header.indexOf("NLine"),
      privId: header.indexOf("PrivilegeID"),
      module: header.indexOf("ModuleName"),
      name: header.indexOf("PrivilegeName"),
    };
    const rows = raw.map((r, idx) => {
      const privId = parseInt(r[ci.privId], 10);
      return {
        idx,
        nLine: parseInt(r[ci.nLine], 10),
        privId: Number.isNaN(privId) ? 0 : privId,
        module: r[ci.module] ?? "",
        name: r[ci.name],
        isGroup: !privId || privId === 0,
      };
    });
    const byNLine = new Map(rows.map((x) => [x.nLine, x]));
    return { header, rows, byNLine };
  }

  VRB.buildMaster = buildMaster;

  // Secure-fields model. Schema: SFID, Label (43 rows, display order). SFID is
  // non-contiguous (1-57 with gaps) — never assume 1..N.
  // text -> { fields:[{sfid,label}], byLabel:Map<label,sfid>, bySfid:Map<sfid,field> }
  function buildSecureFields(text) {
    const { header, rows: raw } = VRB.parseCSV(text);
    const ci = { sfid: header.indexOf("SFID"), label: header.indexOf("Label") };
    const fields = raw.map((r) => ({ sfid: r[ci.sfid], label: r[ci.label] }));
    const byLabel = new Map(fields.map((f) => [f.label, f.sfid]));
    const bySfid = new Map(fields.map((f) => [f.sfid, f]));
    return { fields, byLabel, bySfid };
  }

  VRB.buildSecureFields = buildSecureFields;
})(typeof self !== "undefined" ? self : this);
