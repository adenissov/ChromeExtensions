// Checkbox engine — operates on the Role Setup Form document (the
// oRightPaneContent iframe). Strict-mirror: every privID checkbox is driven to
// (id in yesSet) ? on : off, including live extras with no CSV row. Privilege
// checkboxes appear in DOM in NLine/tree order, so DOM order = parent-before-
// child (used for safe enable/disable ordering — no depth map needed).
(function (root) {
  const VRB = (root.VRB = root.VRB || {});

  const PRIV_SEL = 'input[name="privID"]';
  const BATCH = 25;
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
      el.checked = want; // fallback for the legacy widget
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("click", { bubbles: true, view: doc.defaultView }));
    }
  }

  // Drive the form to the strict-mirror desired state.
  // yesSet: Set<number>. Returns { changed, skippedAbsent, mismatches }.
  async function applyStrictMirror(doc, yesSet, progress) {
    await waitReady(doc);
    expandTree(doc);
    await sleep(300);

    const checks = listChecks(doc);
    const present = new Set(checks.map((c) => parseInt(c.id, 10)));
    const skippedAbsent = [...yesSet].filter((id) => !present.has(id));

    let changed = 0;
    let done = 0;
    // enable in DOM order (parents first); disable in reverse (leaves first)
    const enable = [];
    const disable = [];
    for (const el of checks) {
      const want = yesSet.has(parseInt(el.id, 10));
      if (el.checked === want) continue;
      (want ? enable : disable).push(el);
    }
    const work = enable.concat(disable.reverse());

    for (let i = 0; i < work.length; i++) {
      const el = work[i];
      const want = yesSet.has(parseInt(el.id, 10));
      setCheckbox(el, want);
      changed++;
      if (++done % BATCH === 0) {
        await raf();
        if (progress) progress({ phase: "apply", done, total: work.length });
      }
    }

    // reconcile UI cascades (max 2 passes)
    let mismatches = [];
    for (let pass = 0; pass < 2; pass++) {
      mismatches = [];
      for (const el of listChecks(doc)) {
        const want = yesSet.has(parseInt(el.id, 10));
        if (el.checked !== want) mismatches.push({ id: el.id, want });
      }
      if (!mismatches.length) break;
      for (const m of mismatches) {
        const el = doc.getElementById(m.id);
        if (el) setCheckbox(el, m.want);
      }
      await raf();
    }

    return { changed, skippedAbsent, mismatches };
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
    readEnabled,
  };
})(typeof self !== "undefined" ? self : this);
