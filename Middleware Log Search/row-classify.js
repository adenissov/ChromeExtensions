// Shared status-row classifier. Pure (no DOM, no chrome APIs) so the same
// decision logic runs in both places that need it:
//   - error-trace-click.js (content script) — rows scraped from the OSD/Kibana table
//   - osd-api.js (service worker)            — rows from the search API
// Loaded before each via the manifest content-script list and importScripts.
//
// Input: rows in NEWEST-FIRST order, each normalized by the caller to:
//   { statusCode: number|null, backend: string, extReqId: string, trace: string, ref: any }
// `ref` is opaque to this function — the caller's own source row (a <tr> or an API hit).
//
// Output:
//   { kind: 'noRecords' }
//   { kind: 'success', statusCode, row }   // row = representative row, or null
//   { kind: 'error',   statusCode, row }   // row = first (oldest) non-success row
//
// Rule (mirrors the logic the two callers used to duplicate): take the max
// status across all rows. 200/202 ⇒ success; pick the oldest row that
// represents it (for 202 the oldest 202 row; for 200 the oldest row with a
// non-empty Backend). Anything else ⇒ error; pick the oldest non-success row
// (whose trace yields the error message).
function classifyStatusRows(rows) {
  const isSuccess = (c) => c === 200 || c === 202;
  const isCode = (c) => c != null && !isNaN(c);

  let maxStatus = -1;
  for (const r of rows) {
    if (isCode(r.statusCode) && r.statusCode > maxStatus) maxStatus = r.statusCode;
  }
  if (maxStatus === -1) return { kind: 'noRecords' };

  // Rows arrive newest-first; scan oldest -> newest like the original table scrape.
  const oldestFirst = rows.slice().reverse();

  if (isSuccess(maxStatus)) {
    for (const r of oldestFirst) {
      const represents = maxStatus === 202 ? r.statusCode === 202 : !!r.backend;
      if (represents) return { kind: 'success', statusCode: maxStatus, row: r };
    }
    return { kind: 'success', statusCode: maxStatus, row: null };
  }

  for (const r of oldestFirst) {
    if (isCode(r.statusCode) && !isSuccess(r.statusCode)) {
      return { kind: 'error', statusCode: r.statusCode, row: r };
    }
  }
  return { kind: 'noRecords' };
}

(typeof self !== 'undefined' ? self : globalThis).classifyStatusRows = classifyStatusRows;
