# Test Plan — Verint Role Export/Import Extension

A full, human-readable list of every test scenario, written so a person can read
(or perform) each one. Each case shows its **status**:

- ✅ **Completed (automated) — PASS** — already executed and passing (Layer 1
  offline suite or Layer 2 live LAB run, 2026-05-23). The "How to repeat" line
  says how to re-run it.
- ☐ **Pending — MANUAL** — must be performed by a human (the MV3 popup cannot be
  automated). Result left blank to fill in.

**Build:** branch `secure-fields-employees-module` (includes the F2 fix).
**Environment:** LAB `mv311ver03d.corp.toronto.ca`, org SSHA. All writes are
confined to `ZZ_CLAUDE_TEST_*` sandbox roles.

| Layer | Scenarios | Status |
|---|---|---|
| 1 — Offline engine/validation | 29 | ✅ all PASS |
| 2 — Live LAB (read + write) | 15 | ✅ all PASS |
| 3 — Manual popup UX | 13 | ☐ pending (fill in) |
| **Total** | **57** | 44 PASS · 13 pending |

---

# Layer 1 — Offline engine & validation (automated)

These run with `node dev/test-suite.js` (no browser). They check the pure logic:
reading a config file, validating its structure against the master privilege
list, building the apply plan, writing an export, and ordering secure-field
toggles. **How to repeat (whole layer):** `node dev/test-suite.js` — expect
`Total 29 | PASS 29 | FAIL 0` and a report under `dev/verify/results/`.

## A · Valid configuration files are accepted

### A1 — Superadmin config validates ✅ PASS
**Purpose:** A file where every privilege is `Yes` is recognised as a valid 1-role config.
**What it does:** Parses `fixtures/zz-superadmin.csv`, validates against the master.
**Expected:** `ok=true`, 1 role found.

### A2 — Empty (none) config validates ✅ PASS
**Purpose:** A file where every privilege is `---` is still valid (just grants nothing).
**What it does:** Parses `fixtures/zz-none.csv`, validates.
**Expected:** `ok=true`, 1 role found.

### A3 — Config without the optional PrivilegeDescription column ✅ PASS
**Purpose:** The trailing description column is optional; its absence is fine.
**What it does:** Parses `fixtures/zz-no-pd.csv`, validates.
**Expected:** `ok=true`.

### A4 — Config with a Secure-Fields (E-section) block ✅ PASS
**Purpose:** A file that includes the Employees-module secure-field rows (E01…) validates.
**What it does:** Parses `fixtures/zz-secure-fields.csv`, validates.
**Expected:** `ok=true`.

### A5 — Real multi-role export (`Roles Config.csv`) ✅ PASS
**Purpose:** A genuine 8-role file from the field is accepted.
**What it does:** Parses the real `Roles Config.csv`, validates.
**Expected:** `ok=true`, 8 roles found.

### A6 — Real single-role sample (`Role Export Sample.csv`) ✅ PASS
**Purpose:** A real exported single role validates.
**What it does:** Parses `Role Export Sample.csv`, validates.
**Expected:** `ok=true`.

## B · Corrupted / malformed files are rejected (with the filename named in the error)

Each case takes a known-good file, breaks it one way, and confirms validation
**fails** and the error message is **tagged with the file name**.

### B1 — Non-binary cell fixture (`broken-badcell.csv`) ✅ PASS
**Break:** a role cell holds `MAYBE` instead of `Yes`/`---`. **Expected:** rejected.

### B2 — Duplicate role column (`broken-dupcol.csv`) ✅ PASS
**Break:** two columns share a role name. **Expected:** rejected ("Duplicate role column").

### B3 — Reordered rows (`broken-reorder.csv`) ✅ PASS
**Break:** privilege rows out of master order. **Expected:** rejected (NLine/name mismatch).

### B4 — PrivilegeDescription not last (`broken-pd-not-last.csv`) ✅ PASS
**Break:** description column not in the final position. **Expected:** rejected (ordering).

### B5 — Unknown secure-field label (`broken-sf-badlabel.csv`) ✅ PASS
**Break:** an E-row names a field that doesn't exist. **Expected:** rejected (unknown SF).

### B6 — Truncated file ✅ PASS
**Break:** trailing rows cut off. **Expected:** rejected (row count ≠ master).

### B7 — Missing header row ✅ PASS
**Break:** the header line removed. **Expected:** rejected (header must start NLine/PrivilegeName/Module).

### B8 — Missing NLine column ✅ PASS
**Break:** the first column dropped from every row. **Expected:** rejected (bad header).

### B9 — Dropped privilege rows ✅ PASS
**Break:** several privilege rows removed from the middle. **Expected:** rejected (count/positional mismatch).

### B10 — Reordered rows (generated) ✅ PASS
**Break:** two adjacent privilege rows swapped. **Expected:** rejected.

### B11 — Non-binary cell (generated) ✅ PASS
**Break:** a privilege-row role cell set to `MAYBE`. **Expected:** rejected.

### B12 — Duplicate role column (generated) ✅ PASS
**Break:** the role column duplicated. **Expected:** rejected.

### B13 — BOM + garbage line ✅ PASS
**Break:** a byte-order-mark and junk line prepended before the header. **Expected:** rejected.

### B14 — Empty file ✅ PASS
**Break:** the file is empty. **Expected:** rejected.

### B15 — Single line (header only) ✅ PASS
**Break:** header present, no data rows. **Expected:** rejected (no privilege rows).

### B16 — Bad secure-field discriminator ✅ PASS
**Break:** an E-row's `(View)`/`(Edit)` suffix mangled to `(Viewz)`. **Expected:** rejected.

### B17 — Unknown secure-field label (generated) ✅ PASS
**Break:** an E-row label changed to a bogus field name. **Expected:** rejected.

## C · Apply-plan is computed correctly

### C1 — Superadmin → every privilege enabled ✅ PASS
**Purpose:** The plan for the all-Yes role enables exactly all leaf privileges.
**Expected:** plan Yes-count = 676 (all leaf privileges).

### C2 — None → nothing enabled ✅ PASS
**Purpose:** The plan for the all-`---` role enables nothing.
**Expected:** plan Yes-count = 0.

### C3 — Secure-fields plan matches expectation ✅ PASS
**Purpose:** The View/Edit plan derived from the E-section matches the saved expectation file.
**Expected:** 86 plan entries (43 fields × View+Edit), each matching `_zz-secure-fields-expect.json`.

## D · Export writer round-trips

### D1 — Build → parse → validate → plan parity ✅ PASS
**Purpose:** A CSV produced by the exporter can be read back and is still valid and equivalent.
**What it does:** `buildExportCsv` (with a privilege set + secure-field state) → `parseCSV` → `validateStructure` → `buildPlan`.
**Expected:** validates ok; plan Yes-count and secure-field-plan length match what was written.

## E · Secure-fields apply ordering (F2 regression guard)

Uses a mock that reproduces Verint's rule: a field's **Edit** can't be on unless
its **View** is on, and its **View** can't be cleared while its **Edit** is on.

### E1 — Clearing a View+Edit field converges in one pass ✅ PASS
**Purpose:** Turning a fully-set field off works in a single apply (the bug F2 fixed).
**Expected:** 0 remaining mismatches, both boxes off. *(Proven to fail if the F2 fix is removed.)*

### E2 — Enabling a field (View then Edit) converges in one pass ✅ PASS
**Purpose:** Turning an off field fully on works in a single apply.
**Expected:** 0 remaining mismatches, both boxes on.

---

# Layer 2 — Live LAB run (automated, real engine in the Verint page)

Executed against the LAB via the harness in `dev/live/` (see `dev/live/RUNBOOK.md`).
The real engine was injected into the page; reads/writes used the actual Roles
Setup form. **How to repeat (whole layer):** follow `dev/live/RUNBOOK.md`.

### L1 — Preflight / PROD guard ✅ PASS
**Purpose:** Refuse to run anywhere but the known LAB host; confirm logged in and on the grid.
**Expected:** `ok:true`, host = LAB, Roles grid reachable (it reported 93–94 roles).

### L2 — Inject engine + flow helpers ✅ PASS
**Purpose:** Load the real engine + navigation helpers + 43 secure-field ids into the page.
**Expected:** engine and nav present; 43 secure-field ids.

### L3 — Page probe ✅ PASS
**Purpose:** Confirm the selected org and the role list are readable.
**Expected:** org = SSHA, 93+ roles listed.

### L4 — Open a role editor (row not pre-selected) ✅ PASS
**Purpose:** Double-clicking a role opens its Setup form.
**Expected:** form opens with 696 privilege checkboxes.

### L5 — Open a role editor (row already selected) ✅ PASS
**Purpose:** Re-opening a role whose row is already highlighted still works (this was a fixed bug).
**Expected:** form opens.

### L6 — Read-only export of a real role (`311 Manager`) ✅ PASS
**Purpose:** Read a live role's privileges + secure fields without changing anything.
**Expected:** 215 enabled checkboxes = 211 in-master + 4 live-extras (correctly excluded); 41 of 43 secure fields set; editor cancelled cleanly (no change).

### L7 — Exported CSV round-trips ✅ PASS
**Purpose:** The CSV built from the live read is valid and equivalent.
**Expected:** validates ok; plan Yes = 211; secure-field plan = 86.

### L8 — Apply a consistent config to the sandbox (mirror `311 Manager`) ✅ PASS
**Purpose:** Drive the sandbox role to a real, internally-consistent configuration.
**Expected:** 205 privilege + 28 secure-field toggles; verify gate reports **0 mismatches** (priv and SF).

### L9 — Save the applied config ✅ PASS
**Purpose:** Commit the change.
**Expected:** Save commits; grid returns.

### L10 — Re-open and independently verify exact persistence ✅ PASS
**Purpose:** Confirm what was saved is exactly what was intended.
**Expected:** 0 privilege / 0 secure-field mismatches on a fresh read.

### L11 — Idempotent re-apply ✅ PASS
**Purpose:** Applying the same config again changes nothing and saves nothing.
**Expected:** "already-exact", 0 changed, no Save.

### L12 — Rollback safety (inconsistent plan) ✅ PASS
**Purpose:** A plan that ends in a state Verint won't accept (auto-cascaded extras) must NOT be saved.
**Expected:** verify gate flags the mismatches (4 cascade extras) → **no Save**; role left unchanged.

### L13 — Restore the sandbox to baseline ✅ PASS
**Purpose:** Put the role back exactly as created.
**Expected:** apply + Save succeed.

### L14 — Verify restore ✅ PASS
**Purpose:** Confirm the role equals its original baseline.
**Expected:** exact baseline (271 enabled, secure fields identical).

### L15 — F2 fix re-test (clear converges in one pass) ✅ PASS
**Purpose:** Prove the secure-field ordering fix works live.
**Expected:** the restore (which clears View+Edit fields) converges in ONE apply pass (28 SF changed, 0 mismatch); before the fix it left 8 "View still on".

---

# Layer 3 — Manual popup UX (HUMAN — fill in results)

The browser extension's **popup** cannot be driven by automation, so these are
performed by hand. **Setup for all:** extension loaded (unpacked); logged into
LAB on a Roles Setup page with an org selected (grid visible). For any **import
that writes**, pick a **`ZZ_CLAUDE_TEST_*`** role — never a real one.

### M1 — Export a role to CSV (happy path) ☐ MANUAL
**Steps:**
1. In the Verint grid, click a role to select it.
2. Click the extension icon → click **Export**.
3. When the **Save As** dialog appears, save the file.
**Expected:** filename like `Verint Role Export_<role>_<date>.csv`; popup shows a **green "exported to …"** message and returns to the start screen. Opening the CSV shows header `NLine,PrivilegeName,Module,<role>`, an E-section at top if the role has secure fields, and `Yes`/`---` cells.
**Result:** __PASS__ (PASS / FAIL)  Notes: __________

### M2 — Export interrupted (dismiss Save As) ☐ MANUAL
**Steps:**
1. Start an Export (M1 steps 1–2).
2. When the **Save As** dialog appears, **Cancel** it.
**Expected:** the popup returns **quietly** (no scary error). If the dialog's focus-steal closed the popup, the toolbar icon shows a **`!` badge**; clicking the icon opens the popup and clears the badge.
**Result:** __PASS__  Notes: __________

### M3 — Export badge re-open ☐ MANUAL
**Steps:**
1. Start an Export; allow the Save As dialog to close the popup; complete the save.
**Expected:** toolbar shows a **`✓` badge**; clicking the icon re-opens the popup to the **green result** and clears the badge.
**Result:** __PASS__  Notes: __________

### M4 — Import a config onto a sandbox role (happy path) ☐ MANUAL
**Steps:**
1. Click the icon → **Import**.
2. At the hint "Import: Pick the role config file to import", choose a valid exported CSV.
3. Pick the target role (a `ZZ_CLAUDE_TEST_*` role).
4. Confirm the **owner-org** prompt (the org name shows in **bold**).
5. Confirm the **overwrite** prompt.
**Expected:** an **outcome message** (applied / verified). Re-open that role in Verint and spot-check that a few privileges and secure fields match the imported file.
**Result:** __PASS__  Notes: __________

### M5 — Import a corrupted file (validation error) ☐ MANUAL
**Steps:**
1. Click the icon → **Import**.
2. Choose a corrupted CSV (e.g. one of `dev/verify/fixtures/broken-*.csv`, or hand-edit a header).
**Expected:** the popup shows a **red validation error** that **names the file** and the first problem; **no change is written** to any role.
**Result:** __PASS__  Notes: __________

### M6 — Cancel returns to start: at mode pick ☐ MANUAL
**Steps:** Open the popup (Export/Import buttons showing) → **Cancel / close** without choosing.
**Expected:** returns to the start screen; nothing carried over.
**Result:** __PASS__  Notes: __________

### M7 — Cancel returns to start: at file pick ☐ MANUAL
**Steps:** Import → at the file-pick step, **Cancel**.
**Expected:** returns to the start screen; the file input is cleared.
**Result:** __PASS__  Notes: __________

### M8 — Cancel returns to start: at role pick ☐ MANUAL
**Steps:** Import → choose a file → at the role-pick step, **Cancel**.
**Expected:** returns to the start screen; pick step hidden; file input cleared.
**Result:** __PASS__  Notes: __________

### M9 — Cancel returns to start: at owner-org confirm ☐ MANUAL
**Steps:** Import → file → role → at the **owner-org confirm**, **Cancel**.
**Expected:** returns to the start screen; no write.
**Result:** __PASS__  Notes: __________

### M10 — Cancel returns to start: at overwrite confirm ☐ MANUAL
**Steps:** Import → file → role → owner-org confirm → at the **overwrite confirm**, **Cancel**.
**Expected:** returns to the start screen; no write.
**Result:** __PASS__  Notes: __________

### M11 — Re-run with no stuck state (optional) ☐ MANUAL
**Steps:** Complete an Export, then an Import, then run each **again** back-to-back.
**Expected:** no "stuck on Exporting…/Applying…", no leftover messages from the prior run.
**Result:** __PASS__  Notes: __________

### M12 — Idempotent import (optional) ☐ MANUAL
**Steps:** Import the **same** file twice onto the same sandbox role.
**Expected:** the second run reports "already exact / no changes".
**Result:** __PASS__  Notes: __________

### M13 — In-flight guard (optional, hard to time) ☐ MANUAL
**Steps:** Trigger two Import applies almost simultaneously (e.g. two windows).
**Expected:** the second is rejected as **busy** (only one apply at a time).
**Result:** __PASS__  Notes: __________

---

**Manual sign-off:** Tester ___ALEXANDER DENISSOV___  Date __2026-05-23_______
Core M1–M10: __10__ / 10 PASS   ·   Optional M11–M13: __3__ / 3
Overall notes: ___________________________________________________________
