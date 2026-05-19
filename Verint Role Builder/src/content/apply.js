// Checkbox engine — operates on the Role Setup Form document (the
// oRightPaneContent iframe). Strict-mirror, scoped to the CSV's domain:
// every IN-MASTER privID checkbox is driven to (id in yesSet) ? on : off.
// Live extras with no master row (~20 of 696) are LEFT AS-IS — Verint
// manages them via module bundles / license-gated cascades, and forcing
// them OFF makes the engine fight Verint over checkboxes the CSV never
// named. Privilege checkboxes appear in DOM in NLine/tree order, so DOM
// order = parent-before-child (used for safe enable/disable ordering — no
// depth map needed).
(function (root) {
  const VRB = (root.VRB = root.VRB || {});

  const PRIV_SEL = 'input[name="privID"]';
  const BATCH = 25;
  // Fixed delay between the set pass and the verify scan — lets Verint's
  // legacy widget cascade/re-render finish before we read. 1-3 s per spec;
  // 2 s is the middle of the band.
  const POST_APPLY_DELAY_MS = 2000;
  const isNegId = (el) => /^-\d+$/.test(el.id);
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const raf = () =>
    new Promise((r) => (root.requestAnimationFrame || setTimeout)(r));

  function listChecks(doc) {
    return [...doc.querySelectorAll(PRIV_SEL)].filter(isNegId);
  }

  async function waitReady(doc, { floor = 600, timeoutMs = 20000 } = {}) {
    const start = Date.now();
    let prev = -1;
    let stableHits = 0;
    while (Date.now() - start < timeoutMs) {
      const n = listChecks(doc).length;
      if (n === prev && n >= floor) {
        if (++stableHits >= 2) return n;
      } else {
        stableHits = 0;
      }
      prev = n;
      await sleep(250);
    }
    throw new Error(
      `Privilege tree not ready (last count ${prev}, floor ${floor}).`
    );
  }

  function expandTree(doc) {
    const ex = doc.querySelector("#privTreehdrImg");
    if (!ex) return;
    for (const t of ["mousedown", "mouseup", "click"])
      ex.dispatchEvent(
        new MouseEvent(t, { bubbles: true, view: doc.defaultView })
      );
  }

  function setCheckbox(el, want) {
    const doc = el.ownerDocument;
    for (const t of ["mousedown", "mouseup", "click"])
      el.dispatchEvent(
        new MouseEvent(t, { bubbles: true, cancelable: true, view: doc.defaultView })
      );
    if (el.checked !== want) {
      // fallback for the legacy widget — force state + notify. NOT another
      // click: a synthetic click on a checkbox toggles it again, flipping it
      // back off `want`.
      el.checked = want;
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  const wanted = (el, yesSet) => yesSet.has(parseInt(el.id, 10));

  // Snapshot of every non-disabled, in-master privID checkbox vs. the desired
  // set. Checkboxes whose id is NOT in `masterSet` are "live extras" the CSV
  // has no row for (the ~20 of 696 live boxes absent from the master) — they
  // are out of the CSV's domain, never touched, never counted as mismatches.
  function mismatchList(doc, yesSet, masterSet) {
    const out = [];
    for (const el of listChecks(doc)) {
      const pid = parseInt(el.id, 10);
      if (masterSet && !masterSet.has(pid)) continue;
      if (el.disabled) continue;
      const want = yesSet.has(pid);
      if (el.checked !== want) out.push({ id: el.id, want });
    }
    return out;
  }

  // Drive the form's IN-MASTER checkboxes to the strict-mirror desired state,
  // wait a fixed delay (POST_APPLY_DELAY_MS) so Verint's cascade/re-render
  // can finish, then verify by scanning all in-master checkboxes once.
  // Returns { changed, skippedAbsent, skippedDisabled, skippedNonMaster,
  // mismatches }. `mismatches` is the verify-scan truth — the caller uses it
  // as a transactional gate (save only if empty, else roll back). Out-of-
  // CSV-domain checkboxes (live extras not in master) are LEFT AS-IS;
  // Verint manages them and they cannot fail the gate. `disabled` checkboxes
  // are Verint-managed and skipped, never a mismatch. Single-pass on
  // purpose: any leftover discrepancy is reported by name, never silently
  // retried away.
  async function applyStrictMirror(doc, yesSet, masterSet, progress) {
    await waitReady(doc);
    expandTree(doc);
    await sleep(300);

    const checks = listChecks(doc);
    const present = new Set(checks.map((c) => parseInt(c.id, 10)));
    const skippedAbsent = [...yesSet].filter((id) => !present.has(id));
    const skippedDisabled = [];
    const skippedNonMaster = [];

    let changed = 0;
    let done = 0;
    // enable in DOM order (parents first); disable in reverse (leaves first)
    const enable = [];
    const disable = [];
    for (const el of checks) {
      const pid = parseInt(el.id, 10);
      if (!masterSet.has(pid)) {
        skippedNonMaster.push(el.id);
        continue;
      }
      const want = yesSet.has(pid);
      if (el.checked === want) continue;
      if (el.disabled) {
        skippedDisabled.push(el.id);
        continue;
      }
      (want ? enable : disable).push(el);
    }
    const work = enable.concat(disable.reverse());

    for (let i = 0; i < work.length; i++) {
      setCheckbox(work[i], wanted(work[i], yesSet));
      changed++;
      if (++done % BATCH === 0) {
        await raf();
        if (progress) progress({ phase: "apply", done, total: work.length });
      }
    }

    // Fixed delay so Verint's cascade/re-render can finish, then verify.
    if (progress) progress({ phase: "verify" });
    await sleep(POST_APPLY_DELAY_MS);
    const mismatches = mismatchList(doc, yesSet, masterSet);

    return {
      changed,
      skippedAbsent,
      skippedDisabled,
      skippedNonMaster,
      mismatches,
    };
  }

  // Read current state into a Set of enabled PrivilegeIDs (for verify).
  function readEnabled(doc) {
    const s = new Set();
    for (const el of listChecks(doc))
      if (el.checked) s.add(parseInt(el.id, 10));
    return s;
  }

  VRB.engine = {
    PRIV_SEL,
    listChecks,
    waitReady,
    expandTree,
    applyStrictMirror,
    mismatchList,
    readEnabled,
  };
})(typeof self !== "undefined" ? self : this);
