# Verint Role Export / Import — Architecture & Engineering Plan

Design decisions and the build plan for the coding engine. Companion to
`README.md` (user-facing). No code is written until this is approved.

The Import path is the originally-shipped flow (apply a multi-role CSV
column to a role on the live page); the Export path (2026-05-20) reads an
existing role's privileges off the live page and downloads them as a CSV
in the same shape as `Role Export Sample.csv`. Both share the page
precondition gate, the page/frame model, and the role-editor open/cancel
machinery. Export adds no Save: the editor is opened, read, and cancelled.

---

## 1. Problem & why this design

Provisioning a Verint role means setting up to ~745 privilege checkboxes on
**User Management → Security → Roles Setup**. The existing precedent
(`Roles_Migrate_By_Selenium`: a SQL query that emits Selenium-IDE `.side`
commands, hand-pasted into a template) only *edits existing* roles, is
manual, and is brittle. We want a self-contained tool driven by one CSV that
can hold *many* roles.

**The fact that makes this tractable:** on the Roles Setup page each privilege
checkbox's HTML element `id` **is** its `PrivilegeID`
(`<input id="-10008">`).

### Two CSV schemas (they differ — this is central)

| File | Role | Columns |
|---|---|---|
| **`Privilege Config List.csv`** (embedded at build, the master) | source of truth for order + `PrivilegeID` | `NLine, PrivilegeID, ModuleName, PrivilegeName` |
| **`Roles Config.csv`** (user input, multi-role) | the `Yes`/`---` matrix | `NLine, PrivilegeName, Module, <Role₁ … Roleₙ>[, PrivilegeDescription]` |

The input file has **no `PrivilegeID`**. The engine joins input rows to the
embedded master **on `NLine`** to obtain the `PrivilegeID` it toggles.
Validation cross-checks `PrivilegeName` and `Module` so the join is provably
aligned. Both files have identical `NLine`→`PrivilegeName` order (verified on
the sample).

> **`NLine` is non-contiguous by design:** the generating SQL skips **445**
> (`NLine` runs … 444, 446 …) in *both* the master and every config file, so
> the gap is shared and row-for-row alignment still holds. The validator must
> compare `NLine` positionally vs. the embedded master and **must not** assume
> `NLine` is `1..N` or derive the row count from `max(NLine)`. Effective data
> rows: 766 (NLine max 767, minus the 445 gap).

### Established DOM facts (recon-confirmed 2026-05-18 — see `dev/recon/create-dialog-recon.md`)

| Aspect | Fact |
|---|---|
| Page-detect signal | **Robust:** top-level `iframe#mctnt[src*="role_setup_fs"]` **or** right-pane inner title matches `Role (List\|Setup Form)`. Title/hash are **diagnostics only** (they vary with menu navigation, locale, hash encoding — gating on them caused false negatives). `CHECK_PAGE` returns `{onPage,hasMctnt,mctntSrc,innerTitle,title,hash}`. |
| Frame tree | top → `iframe#mctnt` (container) → `iframe#oRightPaneContent` (grid/editor/create form, src `…/control/role_setup?`) **and** `iframe#oLeftPaneContent` (org tree, src `…/organization_selection_roles`). **Engine frame = `oRightPaneContent`** (depth 2); inject by `frameId`. |
| Owner org | `oLeftPaneContent` doc → **`tr[aria-selected="true"]`** `.textContent` (e.g. `SSHA`). Grid lists roles across the **org hierarchy**, so existence must also match the grid Owner-Organization cell. |
| Roles grid | `oRightPaneContent` doc, **`tr[itemname="<RoleName>"]`**; columns: Role Name, Default Role, Is Admin, Description, **Owner Organization**, Modules. Open editor: double-click row (dispatch `mousedown,mouseup,click ×2,dblclick`) or select + `#toolbar_EDIT_ACTIONLabel`. |
| Create Role | `#toolbar_ADD_ACTIONLabel` → **same Role Setup Form, empty** (no separate dialog). |
| Role Setup Form | `oRightPaneContent`, title `…: Role Setup Form`. Metadata fields by **`name`** (no id): `input[name=roleName]`, `input[name=description]`, `input[name=isAdminRole]` (checkbox). **No `<select>` → no Modules/Owner-Org field.** |
| Checkbox | `input[name="privID"]`, `id` == negative `PrivilegeID`. `PrivilegeID == 0` rows are group headers — no checkbox. Live count 696 (≠ master 676 non-zero; see §6). |
| Expand tree | `#privTreehdrImg` (expand does **not** change checkbox DOM presence). |
| Save / Cancel | BUTTON `#workpaneMediator_toolbar_SAVE_ACTIONLabel` / `#workpaneMediator_toolbar_CANCEL_ACTIONLabel`. |
| Hierarchy | `PrivilegeName` leading spaces (4/level); a child requires its `View` parent — Verint enforces it. |

---

## 2. Key decisions (with rationale)

| Decision | Choice | Why |
|---|---|---|
| Execution engine | **Pure MV3 extension**, content script in the user's live authenticated tab | No external auth, no SWG 403, no session-profile juggling; never types LAB creds. `playwright-cli` is a developer-only test/recon harness, not shipped. |
| Input file | **Multi-role matrix**; user picks one role from a dropdown | Matches the real `Roles Config.csv`; role columns are every header after `Module` (and before the optional trailing `PrivilegeDescription`). |
| PrivilegeID source | **Join input `NLine` → embedded `Privilege Config List.csv`** | Input file carries no `PrivilegeID`; the engine needs it for the checkbox `id`. |
| Validation key | `NLine` + `PrivilegeName` (leading spaces) + `Module`↔`ModuleName`, **exact order** | Proves the join alignment and protects against an out-of-date file. `PrivilegeDescription` is optional and not validated (different snapshot, `NULL` on group rows). |
| Page precondition | **Hard-gate at file upload: must already be on Roles Setup; no auto-navigation** | User requirement; refusing early prevents acting on the wrong page and removes the direct-`goto` 403 risk entirely. |
| Owner org | **Read `tr[aria-selected="true"]` in `oLeftPaneContent`**, confirm with user; existence also matches the grid Owner-Org cell | File has no org; grid bleeds roles across the org hierarchy so the cell match is required. Recon-confirmed. |
| Create metadata | **No user form.** Name = picked role; Description = role name; Is-Admin = unchecked. **No Modules / Owner-Org handling** | Recon: the form has no `<select>`; Modules are Verint-derived, owner org rides the left-pane selection (hidden `selOrgID`). Nothing to set. |
| Create vs. edit surface | **Same Role Setup Form**; Create just opens it empty via `#toolbar_ADD_ACTIONLabel` | Recon: Create is not a separate dialog — one engine, CREATE only prepends 3 field fills. |
| Not-found branch | **Silent create** (no extra confirm) | The owner-org confirm already gated the action; a second "create it?" prompt was redundant happy-path noise. |
| Overwrite | Edit in place + Save; never delete/recreate | Preserves user assignments and owner org. |
| Overwrite semantics | **Strict mirror** — iterate every form checkbox: in `YesSet`→on else off, incl. non-CSV live extras | User decision: resulting role equals the CSV's Yes intent exactly; predictable, no orphan privileges. |
| High-risk roles | **2nd risk-named confirm** if grid row Default Role==Yes or Is Admin==Yes before overwrite | Higher blast radius (primer); explicit extra gate. |
| Verification | **In-UI re-read of every checkbox only** (no SQL) | User decision; self-contained, no DB access. |
| `apply.js` injection | Programmatic `chrome.scripting.executeScript` into the `oRightPaneContent` `frameId` | Recon: engine frame = `oRightPaneContent` (depth 2, src `…/control/role_setup?`); created on demand. |
| Frame addressing | `chrome.webNavigation.getAllFrames` + `frameId` routing | Robust vs. nested `about:blank` frames where `postMessage` origin is fragile. |
| Checkbox toggle | **Simulated click** + read-back-verify; fallback `.checked=`+`change`+`click` | Legacy framework binds cascade/dirty handlers to the event; bare `.checked` Saves stale model state. |
| Parent/child | **No promotion — apply the CSV verbatim** | Verint's UI auto-enables required parents itself; the indentation heuristic over-promoted across section boundaries. Removed for simplicity. |
| Commit model | Save is the single commit point; abort Save on any verify mismatch | All toggling is in-editor memory; a pre-Save failure persists nothing. |

---

## 3. Component breakdown

```
extension/
  manifest.json
  src/
    background.js          messaging hub; frame discovery; injects apply.js
    content/
      bridge.js             top frame: portal nav, org/grid, Create dialog
      apply.js              inner role_setup_fs frame: toggle/save engine
    popup/  popup.html  popup.css  popup.js     upload, validate, role dropdown,
                                                org/overwrite/create prompts
    lib/  csv.js  privileges.js  validate.js  protocol.js
  data/ privilege-config-list.csv     verbatim embedded master (766/767 rows)
  icons/ icon16/48/128.png
dev/
  recon/create-dialog-recon.md         output of the recon step
  verify/fixtures/  sample-roles.csv  broken-*.csv
README.md  ARCHITECTURE.md
```

- **popup.js** — file input; runs `validate.js` fully offline; renders the
  report; shows the **role dropdown** (cancellable); shows the page-resolved
  **owner org** for confirmation; runs the **exists → overwrite?** /
  **not-found → create?** prompts; mirrors progress. Persists parsed
  file + chosen role in `chrome.storage.session` so reopening mid-run keeps
  state.
- **background.js** — resolves the active Verint tab; enumerates frames; picks
  the inner `role_setup_fs` frame; injects `apply.js`; proxies popup↔frame
  messages; single in-flight-run guard.
- **bridge.js** (every frame, acts in top frame) — reports `frameId`+URL;
  reads the selected org from the left-pane tree; checks the grid for
  `//tr[@itemname='<RoleName>']`; double-clicks it; drives the Create-Role
  dialog.
- **apply.js** (inner frame only) — expand tree, read states, diff, toggle,
  reconcile, request Save, verify. Pure DOM, no network.

### manifest.json (MV3) — key fields

- `manifest_version: 3`; `background.service_worker` (`type:"module"`).
- `permissions: ["scripting","activeTab","storage","webNavigation"]`.
- `host_permissions: ["https://mv311ver03d.corp.toronto.ca/*"]` (single host).
- One static `content_scripts` entry: host match, `all_frames:true`,
  `document_idle`, injecting **only** `bridge.js`.
- No `web_accessible_resources`: `data/*.csv` are fetched by the popup (an
  extension page) via `chrome.runtime.getURL`, which does not require it.

---

## 4. CSV parsing & validation (`lib/csv.js`, `lib/validate.js`) — offline

**Parser:** RFC4180/quote-aware (descriptions contain commas, quotes,
newlines), CRLF-agnostic, strips a leading UTF-8 BOM (Excel exports one — else
the first header becomes `﻿NLine`), **never trims** (leading spaces are
hierarchy data).

**Column resolution:** require `NLine`, `PrivilegeName`, `Module` as the
first three columns in that exact order. Role columns = every column after
`Module`, up to the trailing `PrivilegeDescription` if it is present (else to
end of header). Role headers must be non-empty and unique.

**Structural — hard errors, block everything:**
1. Header starts with `NLine`, `PrivilegeName`, `Module` (in that order) and
   has ≥1 role column after `Module`. `PrivilegeDescription` is **optional**;
   if present it must be the **last** column.
2. Same data-row count as the embedded master (766; `NLine` non-contiguous —
   445 absent — so the count is the master's row count, never `max(NLine)`).
3. Per row, in order: input `NLine` == master `NLine`; input `PrivilegeName`
   == master `PrivilegeName` **incl. leading spaces**; input `Module` == master
   `ModuleName` (both empty on group rows).
4. Every role cell on a row where master `PrivilegeID != 0` is strictly `Yes`
   or `---`. On `PrivilegeID == 0` group rows, cells are blank/ignored.
5. `PrivilegeDescription` is **not** validated.

**No parent/child handling.** The CSV is applied verbatim — `buildPlan`
returns exactly the `PrivilegeID`s the chosen column marks `Yes`. Verint's own
UI enables any required parent when a child is enabled; an earlier
indentation-derived auto-promote was removed (it invented false cross-section
parents — leading-space indentation encodes section grouping, not enable
dependency).

**Output:** structured report — errors and the per-role Yes count. Error
messages are prefixed with `[<file name>]` so a failed validation names the
uploaded file. The happy path is **silent**: a passing file shows nothing
and the popup proceeds directly to the role-column dropdown.

---

## 5. Workflow state machine

```
Import click
  └─ page-precondition gate (cached recon)
       ├─ NOT Roles Setup → STOP on mode step (message: "Open User
       │                    Management → Security → Roles Setup, then retry.")
       └─ on Roles Setup → auto-open file picker
              ├─ picker cancelled → back to mode-select
              └─ file chosen → validate
  ├─ errors → STOP (report)
  └─ ok → role-column dropdown + target-name input ──(cancel)──► STOP
            │ pick column (= sourceRoleName) + edit target (defaults to source)
            ▼
        resolve owner org from left-pane tree → confirm ──(cancel)──► STOP
            │
            ▼
        grid existence check on TARGET name
        (itemname row AND Owner-Org cell == confirmed org)
          ├─ exists      → "Overwrite? Yes/No"  ─No─► STOP
          │                  └Yes─► if row Default Role==Yes OR Is Admin==Yes:
          │                          2nd risk-named confirm ─No─► STOP
          │                                                  └Yes─► EDIT path
          └─ not found   → CREATE path → EDIT path   (no extra confirm —
                                                        owner-org confirm
                                                        above already gated)
```

**Source vs. target role name (Import).** The CSV column header
(`sourceRoleName`) selects which `Yes`/`---` column to apply; the editable
**Save as role name** input (`targetRoleName`, defaulting to the source) is
what the extension creates/overwrites on Verint. They are decoupled so a CSV
column can be cloned under a new name without editing the file. Wire format:
the `APPLY` message carries both `sourceRoleName` and `targetRoleName`
(`description` defaults to the target). `bridge.apply` uses the target for
`gridRows`, `openEditor` / `openCreate` and the form's `roleName` field; the
engine in `apply.js` is name-agnostic (operates on `yesIds`/`masterIds`).
`GET_CONTEXT` is called with the target name (existence/overwrite is decided
against the target). The persisted `vrbLastResult` carries both names so the
post-rollback diagnostic names the right thing; status strings differentiate
`source → target` only when they differ.

**Page precondition (gate, on file upload — before any parsing/validation):**
the moment a file is chosen, popup → background → `bridge.js` checks the active
tab is the **Roles Setup** page (recon-finalized signal: top-level
`iframe#mctnt[src*="control/role_setup_fs"]` present **and** title
`Verint - Roles Setup - Security - User Management`; hash contains
`selTab=1_USER_MANAGEMENT-%3E2_SECURITY-%3E3_BBM_GEN_ROLES` as a secondary
check). If not on Roles Setup: show a clear message and **stop — no parsing, no
navigation**. The extension never auto-navigates; the user must be on the page.

### EDIT path (apply a role column to an open editor)
1. `bridge.js`: re-assert still on Roles Setup (session/nav may have changed
   since upload); if not, abort with the same message. **No auto-navigation.**
2. Confirm the owner org is selected in `oLeftPaneContent`
   (`tr[aria-selected="true"]`); wait until the grid row count is stable.
3. Double-click the `oRightPaneContent` row `tr[itemname="<RoleName>"]`
   (dispatch `mousedown,mouseup,click ×2,dblclick` — bare `.click()` is
   insufficient); the editor replaces the grid **in the same frame**
   (`oRightPaneContent`) — re-inject/await `apply.js` there; form title becomes
   `…: Role Setup Form`.
4. `apply.js`: click `#privTreehdrImg`; **readiness gate** — poll until the
   `input[name=privID]` negative-id count is **stable across 2 polls**
   (primary), sanity floor ≈ 600. Recon: 696 render (vs master 676 non-zero —
   §6); never hard-equate to a master count.
5. **Strict mirror, scoped to the CSV's domain.** `YesSet` = {`PrivilegeID` :
   chosen column cell == `Yes`} (CSV verbatim, no promotion). `MasterSet` =
   {every non-group `PrivilegeID` in the master `Privilege Config List.csv`}
   — the universe the CSV has any opinion on. Iterate `input[name=privID]`
   in the form, **filtering to checkboxes whose id is in `MasterSet`**:
   desired = `id ∈ YesSet`, else **OFF**. Read current via `.checked`; act
   only where it differs. Live checkboxes whose id is **not** in `MasterSet`
   (~20 of 696 in LAB — Verint-side module bundles / license-gated parents,
   none of them in the DB-dump source of the CSV) are **left as-is** and
   reported as `skippedNonMaster`. They are out of the CSV's domain; forcing
   them OFF was the cause of the `SSHA - Manager V3` rollback (live extra
   `-10484`, Verint cascade-enforced ON by a Yes child). Any CSV `Yes`
   `PrivilegeID` whose checkbox is **absent** from the form → cannot enable
   → **skip + report** as `skippedAbsent` (license/scope-gated this env).
6. Order: enable in DOM order, disable in reverse DOM order (privID checkboxes
   are emitted in NLine/tree order, so this is naturally parent-before-child /
   leaves-first without a depth map).
7. Toggle by simulated bubbling click + read-back-verify; fallback
   `.checked=`+`change` **only** (no extra click — a synthetic click re-toggles
   a checkbox). Throttle in batches of ~25 with a
   `requestAnimationFrame`/`setTimeout(0)` yield.
8. Skip **`disabled`** checkboxes (Verint-managed by dependency/license — no
   one can change them; reported as `skippedDisabled`, never a mismatch).
   After the toggle pass, **wait a fixed `POST_APPLY_DELAY_MS` (2 s)** so
   Verint's legacy widget cascade/re-render can finish, then run a single
   verify scan (`mismatchList`). One pass, on purpose: any leftover
   discrepancy is reported by `name (id)` rather than silently retried away.
   Replaces an earlier `settle()` poll + bounded correction, which still
   produced `mismatches:1` on set-specific cascades and obscured what was
   stuck. (Decision 2026-05-19, per user spec.)
9. **Transactional gate (verify-or-rollback, 2026-05-19).** `bridge.apply`
   takes a *final authoritative read* (`E.mismatchList`) immediately before
   Save. The result is **persisted to `chrome.storage.local`
   (`vrbLastResult`) BEFORE Cancel** — Verint's native "changes will not be
   saved" `confirm()` fires on Cancel-of-dirty-form and closes the MV3
   popup. (As of 2026-05-20 the popup no longer re-renders this persisted
   result on open — the start screen is kept clean; see §10. `vrbLastResult`
   is still written to `chrome.storage.local` for forensic inspection.)
   - **Exact (no mismatches)** → `saveCommit()` → on `gridBack()` return
     `ok:true, verify:"verified-exact"`.
   - **Any real discrepancy** → **do NOT Save**. Roll back via the form's own
     **Cancel**, then `gridBack()` *before* any other navigation. Return
     `ok:false, rolledBack:true, reason:"verify_failed_role_{not_created|
     unchanged}"`, with the off-target privileges by `name (id)`. Clean Cancel
     is prompt-free — Verint's native unsaved-changes guard fires only on
     *navigation away* from a dirty form, not on Cancel (LAB-instrumented).
   - Idempotent **edit** (0 changed, 0 mismatch) → Cancel, `verify:"already-
     exact"`, `saved:false` (no needless Save). **Create** with 0 privileges
     still Saves (must persist the empty role).
   This makes every run end in exactly one labelled state — *verified success*
   or *safe no-op with a named diagnostic* — never a silent partial role.
10. **`saveCommit()`**: click Save (BUTTON
    `#workpaneMediator_toolbar_SAVE_ACTIONLabel`, fallback TD
    `#SAVE_ACTION_id`, re-resolved each attempt) — a *bubbling* click reaches
    the real handler on the parent table. **Confirm the commit** via
    `gridBack()` (title `Role List` **and** rows). If not committed →
    `cancelForm` + `gridBack` + `reason:"save_not_committed"`,
    `rolledBack:true` (never report `saved:true`). Verify = the pre-Save
    authoritative read **plus** the confirmed commit; no reopen-to-re-read
    (that extra editor-open trips the native guard and adds nothing over an
    exact pre-Save read + `gridBack`).

### CREATE path (recon-resolved — same form, not a separate dialog)
Recon confirmed Create Role opens the **same Role Setup Form**, empty. The
create path is no longer blocked.
1. `bridge.js`: click grid toolbar `#toolbar_ADD_ACTIONLabel`; the empty Role
   Setup Form replaces the grid in `oRightPaneContent`.
2. Fill (scoped to the form, by `name`): `input[name=roleName]` = picked role;
   `input[name=description]` = role name; leave `input[name=isAdminRole]`
   unchecked. No Modules / Owner-Org fields exist (owner org follows the
   left-pane selection via hidden `selOrgID`). In LAB, warn if the name lacks
   `ZZ_CLAUDE_TEST_`.
3. **Converge to EDIT path step 4 onward** (readiness gate → apply column →
   Save) — identical engine; only Save commits the new role.

---

## 6. Build & verify sequence

1. Scaffold the tree; copy `Privilege Config List.csv` →
   `extension/data/privilege-config-list.csv` verbatim. **Check:** row count,
   exact header, leading spaces preserved.
2. Implement `lib/`; validate the sample `Roles Config.csv` and broken
   fixtures (reordered row, renamed header, bad cell, duplicate role column,
   missing role column). **Check:** sample passes; each broken fixture yields
   the expected error; role dropdown lists all 8 sample roles.
3. Implement popup (dropdown + org confirm + overwrite/create prompts) +
   background + `bridge.js` + first-cut `apply.js`.
4. Load unpacked in LAB via `playwright-cli open --headed --profile
   'C:\Users\adeniss\.playwright-sessions'`; confirm NOT on `dbrealmsignin`.
   **Check:** validates offline; dropdown + org read from page work; cancel at
   each prompt aborts cleanly.
5. (Recon already complete — `dev/recon/create-dialog-recon.md`.) Build-time:
   diff the live `privID` id set vs master non-zero; log extras/missing for the
   skip report.
6. Code the create path (same form as edit, per recon).
7. Create `ZZ_CLAUDE_TEST_NONE` (crafted all-`---` column). **Check:** create
   prompt fired; role created with Description=name, Is-Admin off; reopen → all
   unticked.
8. Create `ZZ_CLAUDE_TEST_SUPERADMIN` (all-`Yes` column). **Check:** reopen →
   every renderable checkbox ticked; report lists any CSV `Yes` skipped as
   absent.
9. Edit path, strict mirror, on an existing role column (e.g.
   `SSHA - Supervisor`): overwrite prompt fired; **and** the Default/Is-Admin
   2nd confirm fires when applicable. **Check:** role equals the column exactly
   (Yes on, everything else incl. non-CSV extras off — except any
   Verint-enforced parent, §8); report matches; off-org name → "not found".
10. Idempotency: re-apply the same role twice. **Check:** 0 changes; Save
    skipped.
11. In-UI verify pass: reopen each test role, re-read all checkboxes, assert ==
    strict-mirror desired. (No SQL.)
12. `playwright-cli close-all`. No PROD. Only `ZZ_CLAUDE_TEST_*` writes. Run
    `/wrapup` (mandatory KB update).

---

## 7. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Session timeout (~5 min idle) mid-apply | Probe an authenticated signal before Apply and before Save; abort (never Save); keep file + role pick in `chrome.storage.session`. |
| Not on Roles Setup at upload | Hard precondition gate refuses before any parsing, with a clear "open Roles Setup and retry" message; re-asserted at EDIT step 1 in case of mid-run navigation. |
| Wrong org selected on page | Owner org is shown for explicit confirmation before the existence check; "not found" message names the org so a wrong scope is obvious. |
| Tree not fully rendered | Readiness gate (count stable + threshold); abort with a clear message if never reached. |
| Wrong frame injected | If 0 negative-id checkboxes after expand → abort (do not Save an empty role); with >1 candidate pick the deepest. |
| Join misalignment (input vs master) | Per-row `NLine`+`PrivilegeName`+`Module` exact-order check; any drift is a hard error before any toggling. |
| Duplicate / empty role-column headers | Hard validation error; dropdown never built from an ambiguous header. |
| ~745 rapid events | Batch + rAF yield, then `sleep(POST_APPLY_DELAY_MS)` (2 s) before the single verify scan. |
| Verint auto-enables a parent of a Yes child (CSV parent `---`) | Fixed 2 s post-apply delay lets the cascade finish. The input CSV is a DB dump of *valid saved roles*, so it has no internal parent/child contradictions; a leftover post-delay mismatch is therefore real → transactional gate rolls back (no partial role) and names it. |
| Create-vs-edit misdetection | Decide only after grid row count is stable; warn (don't guess) on a casing-different same-named row. |
| Live privilege set ≠ master (696 vs 676) | Strict mirror is **scoped to the master's privIds**: live extras outside the master are left to Verint (`skippedNonMaster`), never toggled, never gate Save. CSV `Yes` with no live checkbox → skip+report (`skippedAbsent`). Was the root cause of the `SSHA - Manager V3` rollback (2026-05-19): live extra `-10484` was Verint cascade-enforced ON by a Yes child and the old "force non-master OFF" policy fought the cascade. |

---

## 8. Status & remaining open items

**Recon complete (2026-05-18)** — all six unknowns resolved; see
`dev/recon/create-dialog-recon.md`. Net effect: CREATE is no longer blocked
(same form as EDIT), no metadata form needed, all selectors finalized in §1.
Both EDIT and CREATE paths are now fully specified and codeable.

Remaining:
- **Approval to begin the build** (Step 2 of the plan — separate from the
  recon approval).
- *(Resolved: SQL round-trip dropped — verification is in-UI re-read only.)*
- **Post-Save UX — RESOLVED (2026-05-19, instrumented).** Save commits 1st &
  2nd time (bubbling click; handler on the parent table). Verint dialogs are
  **native** `confirm()`/`beforeunload` (uncatchable by a content script);
  Verint's Cancel button discards a dirty form cleanly. The user's
  unsaved-changes bug was the old `waitGrid` transient-match race — fixed via
  strict `gridBack` + commit-confirm + Cancel-button discard + honest failure
  (the native guard is never *triggered*, so it needn't be *handled*). See
  recon §7. Duplicate-name / parent-required validation errors remain
  unobserved (need bad input) — current code returns honest failure; minor.
- **Live privilege set ≠ master (696 vs 676 non-zero +20).** Build-time task:
  diff the live `privID` id set vs master so the report can explain skips; not
  a blocker (engine already skips+reports absent ids).
- **Auto-promote removed (2026-05-19).** The indentation heuristic invented
  false cross-section parents (it crossed group-header boundaries); Verint's UI
  enables genuine parents itself. The CSV is now applied verbatim. The old
  "does Verint cascade-enable a parent?" question is moot under the
  transactional model: the CSV is a DB dump of valid roles (any enabled child
  already has its parent enabled in the same column), `settle()` lets any
  Verint cascade finish before the authoritative read, and a genuine post-
  settle mismatch rolls the run back with a named diagnostic rather than
  Saving a wrong role. Open only if a real, reproducible mismatch is reported.

---

## 9. Export feature (2026-05-20)

Export reads the privileges of one existing role and writes them to a CSV in
the shape of `Role Export Sample.csv`. It is read-only against Verint — the
editor is opened, every checkbox is read, the editor is **cancelled** with
no Save.

### Workflow state machine

```
popup open  →  silent recon  →  pageOk?
  ├─ Export click (off-page)        → "For extension to work, open it on the
  │                                    'Roles Setup' page." (stay on mode step)
  └─ Export click (on Roles Setup)  → LIST_ROLES
       ├─ grid empty                → "No roles on this page." (stay on mode)
       └─ ok                        → exportStep:
                                        dropdown of roles ── Cancel ─► STOP
                                        │ Export click
                                        ▼
                                      EXPORT_READ:
                                        openEditor(role)
                                        waitReady + expandTree
                                        E.readEnabled(R)
                                        cancelForm(R) + gridBack()
                                      buildExportCsv(master, role, enabled)
                                      chrome.downloads.download(saveAs:true)
                                        ► browser Save-As dialog
```

### Key decisions

| Decision | Choice | Why |
|---|---|---|
| Row set | **Master CSV order** (766/767 incl. group rows) | Matches `Role Export Sample.csv`; the importer accepts this no-`PrivilegeDescription` shape directly (round-trip just works). |
| Live extras (~20) | **Omitted** | Sample has exactly the master row set. Live extras are Verint-managed (license/module bundles) and have no master row to map to. |
| Read mechanism | **Open editor → `E.readEnabled(doc)` → cancel** | Re-uses the proven Import open/cancel path. The grid summary doesn't carry per-privilege state. |
| Cancel path | Same `cancelForm(R) + gridBack()` as the idempotent-edit branch | View-mode read does not toggle any checkbox → form is not dirty → Cancel is prompt-free (no native unsaved-changes guard). |
| Output column header | `<role-name>` verbatim | Mirrors the sample; the importer would treat that header as a role column. |
| Group rows | Module column blank; role column blank | Mirrors the sample. |
| Filename | `Verint Role Export_<role>_YYYY-MM-DD.csv` | Per spec. Date is local-time `toISOString().slice(0,10)`. |
| Filename sanitization | Replace `/\:*?"<>|` and control chars in role name with `_` | Windows-invalid characters; everything else (incl. spaces) passes through. |
| Download mechanism | `chrome.downloads.download({ url: data-URL, filename, saveAs: true })` from the **background SW** | `saveAs:true` triggers the native folder picker; the SW outlives the popup (which the Save-As dialog tears down), so the hint is honored every run. |
| Save-As prompt | Frameless black line **"Export: Select destination folder"** in the dialog header's font/size, normal weight (`#exportPrompt`), shown when the download is kicked off | Per spec — replaced the framed `#status` "Export ready…" panel. The framed `#status` is kept only for the export *error* path. |
| Export progress message | **None.** No "Opening editor…" status between Export-click and the Save-As prompt (2026-05-20) | Per spec; the editor open/read/cancel is fast and the only message the user needs is the destination prompt. |
| Persist save folder | **Removed (2026-05-22).** `downloads.download`'s `filename` must be relative to Downloads, so prepending the absolute last-used directory was rejected with "Invalid filename" on every export after the first — it logged an error then fell back to the basename, and the dialog never actually reopened at the saved folder. Now the SW passes only the basename; the browser's own Save-As dialog remembers the last location. (Removed `vrbExportDir`, `downloads.onChanged`, `dirOf`, and the retry.) |
| CSV quoting | RFC4180: quote only fields containing `,`, `"`, `\n`, or `\r`; double internal quotes | Sample uses bare unquoted leading spaces — quoting only when required keeps round-trip simple. |
| Concurrency | **No background lock** — Export does not Save and does not contend with Import's apply lock | Import's `applyInFlight` guard is preserved as-is. If an Import is mid-run, Export reads can still proceed (different message path). |

### New messages

- `LIST_ROLES` → `bridge.listRoles()`:
  - precondition: `isRolesSetup()` else `{error:"not_on_roles_setup"}`.
  - roles: enumerate every `tr[itemname]` in `rightDoc()` (right-pane grid,
    unfiltered — no OwnerOrg comparison), project to the `itemname` attr,
    dedupe, sort alpha. Empty grid → `roles: []` and the popup renders the
    empty-state.
  - returns `{ roles: string[] }`.
- `EXPORT_READ { roleName }` → `bridge.exportRead`:
  - precondition: `isRolesSetup()` + role still present in the grid.
  - `R = openEditor(roleName)` (same call as Import).
  - `await E.waitReady(R)` / `E.expandTree(R)` (parity with the read-back
    surface Import uses).
  - `const enabled = [...E.readEnabled(R)]` (number[] of negative privIDs).
  - `await cancelForm(R) ; await gridBack()`.
  - returns `{ enabledIds: number[] }` or an error.

### CSV writer (`lib/csv-export.js`)

Pure function:

```js
buildExportCsv(master, roleName, enabledSet) -> string
```

- Header: `NLine,PrivilegeName,Module,<roleName>`.
- For each master row in order:
  - group row (`isGroup`): `<nLine>,<priv-name>,,`
  - leaf row: `<nLine>,<priv-name>,<module>,<Yes|--->`
- `enabledSet` is `Set<number>` of master `privId`s read from the form.
- RFC4180 quoting helper applied to each field. Lines terminated with
  `\r\n` (Excel-friendly; the existing parser accepts both).

### Manifest delta

Add `"downloads"` to `permissions`. Host pattern unchanged
(`https://*/wfo/*`). No new `content_scripts` entries.

### What Export does NOT do

- Does not Save to Verint (no `saveCommit`, no progress phase).
- Does not include `PrivilegeDescription` (the sample doesn't either; the
  Import schema treats that column as optional, so a re-import of an export
  works as-is).
- Does not include live extras (~20 checkboxes outside the master).
- Does not capture role metadata (Is-Admin, Description, Owner Org, Modules)
  — out of scope for this iteration; can be added if a future round-trip
  requirement comes up.

---

## 10. Popup result UX (2026-05-20)

- **No carry-over panel on open.** The popup no longer re-renders the last
  persisted run result when it opens (`showLastResult` removed). The start
  screen always shows just the Export/Import choice — the `#report`/`#status`
  panels are populated only by the live flow, never on launch.
- **Unified import outcome surface.** Every import outcome — create success,
  overwrite success, idempotent no-op, and any failure/rollback — renders
  through the single frameless `#outcomeStep`: a `#outcomeMsg` line in the
  shared header font (no border) above a blue **OK**
  button. `#outcomeMsg.ok` is green, `#outcomeMsg.err` is red. The line is the
  **top-line outcome only** — no stats (changed-checkbox count, live-extras,
  skipped-absent, mismatch list are not shown). `showOutcome(html, ok)` is the
  one entry point; `renderResult` maps a result to a single top line (create →
  *Role "X" created successfully*; verified → *Role saved and verified exact.*;
  already-exact → *Role already matched the CSV exactly — nothing to save.*;
  failure → the `REASONS`/`reason`/`error` head). OK calls `backToMode()`,
  redrawing the start dialog. (Replaces the earlier split between a green
  create-only `#successStep` and a framed `#status` panel that listed full
  diagnostics. `privLabel` was dropped with the stats block.)
- **Diagnostics moved to forensic-only.** The detailed breakdown (off-target
  privileges by `Name (id)`, skipped counts, rollback note) is no longer shown
  in the popup. `vrbLastResult` is still persisted by `bridge.js` before any
  blocking Cancel; inspect `chrome.storage.local` for the named diagnostics
  after a rollback.
- **No post-Continue stats panel.** After Continue (and the owner-org /
  overwrite confirms), the apply runs straight to the outcome line — the
  earlier framed `#status` panel that listed *"Mode: … / Enable (Yes): N /
  Applying…"* is gone. `#status` now only carries export/error text, never an
  import progress stat.
- **Import dialog centering.** The owner-org / overwrite confirm (`#confirm`,
  carrying messages like *"Owner organization is …"*) is center-aligned, as is
  `#outcomeStep`.
- **Import pick-step labels.** The role dropdown is labelled *Role name in role
  config \*.CSV* and the target input *Name of the role to create*.
- **Unified prompt/message font (2026-05-20).** Every prompt and message
  surface — `#report`, `#status`, `#confirmMsg`, `#outcomeMsg`, `#exportPrompt`,
  `#targetNameErr` — shares the `h1` header font (`"Segoe UI", system-ui,
  sans-serif` at 15px) and is **bold**. One CSS rule sets the trio; the
  prior monospace 12px on `#report`/`#status`, `font: inherit` on
  `#outcomeMsg`, and the 12px on `#targetNameErr` were removed so nothing
  overrides it. Colour classes (`.err`/`.ok`/`.warn`) and the framed border on
  `#report`/`#status` are unchanged.

---

## 11. Secure Fields (Employees Module) — export/import (2026-05-21)

Adds the role editor's **Secure Fields (Employees Module)** table to both
Export and Import, inside the *same* CSV. Recon: `dev/recon/secure-fields-recon.md`.

### DOM model (recon-confirmed)

| Aspect | Fact |
|---|---|
| Container | `table#workpaneMediator_sfList_tbl_id` in the `oRightPaneContent` form doc (same frame as the privID tree). 1 header row (`<th>View/Edit/Description</th>`) + 43 field rows. |
| View checkbox (canonical) | `input[type=checkbox][name="viewSFID"]`, `value="<SFID>"`, `id="viewSFID_<SFID>_<rowIdx>"`. **43 present, all rows** — `.checked` is the authoritative state. |
| Edit checkbox (canonical) | `input[type=checkbox][name="editSFID"]`, `value="<SFID>"`, `id="editSFID_<SFID>_<rowIdx>"`. 43 present. |
| Forced-field overlay | `input[name="bChk_<kind>SFID"][value="<SFID>"]` (wrapped in `<a role="checkbox" class="disabledCheckboxWrapper" aria-disabled>`) is rendered **only for the few Verint-forced fields** (e.g. First/Last Name, Organization). Its `disabled` marks that field read-only. For forced fields the **checkmark sits on this overlay** while the plain `viewSFID`/`editSFID` input stays **unchecked** — so state must be read as the **OR of plain ∨ overlay** `.checked` (neither alone is complete; live-confirmed 2026-05-22). |
| Identity | **`value` = SFID** (stable; non-contiguous 1–57 w/ gaps). The id's trailing `_<rowIdx>` is display order, not stable. |
| Editability | A field is locked when its `bChk_` overlay exists and is `disabled` (Verint-forced); those are skipped on apply, never a mismatch — like a disabled privID box. The remaining fields are editable. (The earlier "gated by owner-org match" theory was wrong — disproven 2026-05-22; ~40 of 43 are editable for `adeniss` here.) |

### Embedded data

`extension/data/secure-fields.csv` (new packaged data file, fetched by the
popup via `chrome.runtime.getURL` — no `web_accessible_resources` entry, same
as the master), schema
`SFID,Label`, 43 rows in display order. Loaded by `privileges.js`
(`VRB.buildSecureFields(text) -> { fields:[{sfid,label}], byLabel, bySfid }`)
and attached to the master object as `master.secureFields` by the popup and
the test harness.

### CSV E-section

- **Placed first**, after the header, before the privilege rows (user
  preference — quick review without scrolling). Recognised by NLine prefix
  `/^E\d+$/`, **not** by position.
- **Two rows per field** (View row + Edit row), `NLine` = `E01…ENN` (own
  sequence; privilege `NLine`s unchanged). `PrivilegeName` = `<label> (View)`
  / `<label> (Edit)`; `Module` = `Employees`; role cell = `Yes`/`---`.
- Reuses the existing `Yes`/`---` binary across validate/export/apply — maps
  1:1 onto the two DOM checkboxes.

### Validation (`validate.js`)

`validateStructure` **partitions uploaded rows by NLine prefix**: `E`-rows
vs. privilege rows. Privilege rows are mirrored positionally against the
master exactly as before (E-rows filtered out first, so their leading
placement doesn't shift the mirror; error line numbers use original row
index). `E`-rows are validated by: `PrivilegeName` matches
`^(.*) \((View|Edit)\)$`, label ∈ `master.secureFields.byLabel`, cell ∈
`{Yes,---}`. The E-section is **optional** (zero E-rows still validates —
back-compat). `buildPlan` additionally returns `secureFieldsPlan` =
`[{ sfid, view:bool, edit:bool }]` for the chosen column.

### Engine (`apply.js`) & bridge

- `readSecureFields(doc)` — for each known SFID, state = `.checked` of the
  plain `input[name="viewSFID"|"editSFID"][value=SFID]` **OR** of the
  `bChk_<kind>SFID` overlay (forced fields keep the check on the overlay). A
  `disabled` overlay also flags the field locked (apply skips it). Returns
  `{ sfid: {view,edit} }`.
- `applySecureFields(doc, plan, sfMasterSet)` — strict-mirror parallel to
  `applyStrictMirror`: drive each in-master SFID's view/edit checkbox to the
  plan; **skip `disabled`/`aria-disabled` controls** (report `skippedSF`,
  never a mismatch); include real discrepancies in the same transactional
  gate (roll back, no Save).
- `bridge.exportRead` returns the secure-fields state alongside `enabledIds`;
  `bridge.apply` drives `applySecureFields` after the privID pass. Carried on
  the existing `EXPORT_READ` / `APPLY` messages (extra fields; no new type).

### Export (`csv-export.js`)

`buildExportCsv` emits the **E-section first** (two rows per field from the
read state), then the privilege rows. Round-trip stays exact.

### Pending live verification

The owner-org-match unlock and the toggle path are confirmed by the user but
not yet re-exercised live (recon §4/§5). To confirm with SSHA selected:
open an SSHA-owned role, verify all 43 controls render enabled, the toggle
works, and whether enabling Edit auto-enables View.
