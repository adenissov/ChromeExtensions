// RFC4180 CSV parser. Quote-aware (escaped "" inside quotes), CRLF-agnostic,
// strips a single leading UTF-8 BOM. Never trims a field — leading spaces in
// PrivilegeName ARE the hierarchy data.
(function (root) {
  const VRB = (root.VRB = root.VRB || {});

  function parseCSV(text) {
    if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); // BOM
    const rows = [];
    let field = "";
    let row = [];
    let inQuotes = false;
    let i = 0;
    const n = text.length;

    const endField = () => {
      row.push(field);
      field = "";
    };
    const endRow = () => {
      endField();
      rows.push(row);
      row = [];
    };

    while (i < n) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i += 2;
            continue;
          }
          inQuotes = false;
          i++;
          continue;
        }
        field += c;
        i++;
        continue;
      }
      if (c === '"') {
        inQuotes = true;
        i++;
        continue;
      }
      if (c === ",") {
        endField();
        i++;
        continue;
      }
      if (c === "\r") {
        if (text[i + 1] === "\n") i++;
        endRow();
        i++;
        continue;
      }
      if (c === "\n") {
        endRow();
        i++;
        continue;
      }
      field += c;
      i++;
    }
    // trailing field/row if no final newline
    if (field.length > 0 || row.length > 0) endRow();

    // drop a single trailing empty row produced by a final newline
    if (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === "") {
      rows.pop();
    }

    const header = rows.shift() || [];
    return { header, rows };
  }

  VRB.parseCSV = parseCSV;
})(typeof self !== "undefined" ? self : this);
