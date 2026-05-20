// Builds a role-export CSV in the shape of `Role Export Sample.csv`:
//   NLine, PrivilegeName, Module, <roleName>
// Group rows (master PrivilegeID==0) emit blank Module + blank role cell;
// leaf rows emit master ModuleName and "Yes" / "---". Row order = master.
// Live extras (privIds not in the master) are intentionally excluded; the
// sample is exactly the master row set.
(function (root) {
  const VRB = (root.VRB = root.VRB || {});

  // RFC4180 quoting — only when the field contains a delimiter / quote / CR /
  // LF. Leading spaces in PrivilegeName are preserved verbatim (the sample
  // does not quote them).
  function csvField(v) {
    const s = v == null ? "" : String(v);
    if (/[",\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }
  const csvRow = (cells) => cells.map(csvField).join(",");

  // master: { rows: [{ nLine, privId, module, name, isGroup }, …] }
  // enabledSet: Set<number> of privIds currently checked on the live form.
  function buildExportCsv(master, roleName, enabledSet) {
    const lines = [csvRow(["NLine", "PrivilegeName", "Module", roleName])];
    for (const r of master.rows) {
      if (r.isGroup) {
        lines.push(csvRow([r.nLine, r.name, "", ""]));
      } else {
        const flag = enabledSet.has(r.privId) ? "Yes" : "---";
        lines.push(csvRow([r.nLine, r.name, r.module, flag]));
      }
    }
    return lines.join("\r\n") + "\r\n";
  }

  // "SSHA - Manager V3"  ->  "SSHA - Manager V3" (unchanged)
  // "Bad/Name:*"         ->  "Bad_Name__"
  function sanitizeForFilename(s) {
    return String(s == null ? "" : s)
      .replace(/[\/\\:*?"<>|\x00-\x1f]/g, "_")
      .replace(/\s+$/g, "");
  }

  // 2026-05-20 -> "2026-05-20" (local date).
  function todayYMD(d = new Date()) {
    const pad = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
  }

  function exportFilename(roleName, date) {
    return (
      "Verint Role Export_" +
      sanitizeForFilename(roleName) +
      "_" +
      todayYMD(date) +
      ".csv"
    );
  }

  VRB.buildExportCsv = buildExportCsv;
  VRB.exportFilename = exportFilename;
  VRB.csvSanitize = sanitizeForFilename;
})(typeof self !== "undefined" ? self : this);
