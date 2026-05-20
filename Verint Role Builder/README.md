# Verint Role Export / Import — Chrome Extension (User Guide)

A Chrome extension for the Verint **User Management → Security → Roles Setup**
page with two modes:

- **Import** — build or update a Verint role from a multi-role **role
  configuration CSV**. Each role is a column of `Yes` (enable) / `---`
  (disable) values across every Verint privilege; the extension ticks/unticks
  all checkboxes for the picked role in your logged-in tab.
- **Export** — read an existing role's privileges off the live Roles Setup
  page and download them as a CSV (same row order as the master privilege
  list; one role-column per file). Read-only against Verint — nothing is
  changed in the system.

> **Status:** design phase. This document describes the intended user
> experience so it can be reviewed before any code is written.

---

## 1. What it does (and does not do)

After opening the popup you choose **Export** or **Import**. Both require you
to already be on the Roles Setup page; neither auto-navigates.

**Import — does:**
- Reads a multi-role CSV (`Roles Config.csv` — the name is arbitrary).
- Refuses to do anything unless you are already on the **Roles Setup** page —
  the file is only processed once that precondition is met.
- Validates the file's structure against the built-in master privilege list so
  a malformed or out-of-date file is caught **before** anything changes.
- Lets you pick one role from a dropdown of all roles found in the file.
- Resolves the owner organization from the Roles Setup page and asks you to
  confirm it.
- Checks whether that role already exists under that org:
  - **Exists** → asks "overwrite? yes/no"; on yes, sets its privilege
    checkboxes to match the file column and saves.
  - **Not found** → silently creates the role under the confirmed org and
    applies the column (the owner-org confirm already gated this).
- Applies the chosen column **verbatim** — it does not add or infer any
  privilege. (Verint's own UI enables a required parent when you enable a
  child; the tool does not second-guess that.)
- Verifies the result afterwards by re-reading every checkbox.

**Export — does:**
- Lists all roles currently shown on the Roles Setup page (the right-pane
  grid, regardless of which organization owns each role), as a dropdown.
- For the role you pick, opens its editor, reads every privilege checkbox,
  cancels (no changes), and writes the result to a CSV.
- Triggers a standard browser **Save As** dialog so you choose the
  destination folder. Default file name:
  `Verint Role Export_<role-name>_YYYY-MM-DD.csv`.

**Does not:**
- Log you in. You must already be signed in to Verint in the active tab. The
  extension never types or stores credentials.
- Touch PROD in this first version. It is built and proven against **LAB**
  only, using throwaway `ZZ_CLAUDE_TEST_*` roles.
- Change anything without an explicit "yes". Every prompt is cancellable; "no"
  / cancel = nothing happens.
- Delete or recreate an existing role. "Overwrite" edits the privileges of the
  existing role in place (user assignments are preserved).
- Ask you for Modules, Is-Admin, or a Description — see §5.

---

## 2. Installing the extension

1. Open Chrome → `chrome://extensions`.
2. Turn on **Developer mode** (top-right).
3. Click **Load unpacked** and select the `extension/` folder from this
   project.
4. The **Verint Role Builder** icon appears in the toolbar. Pin it.

There is no Web Store install — it is loaded unpacked on the machine that
already has the Verint LAB session.

---

## 3. The role configuration CSV

A multi-role matrix. Column layout (header names are fixed except the role
columns):

```
NLine, PrivilegeName, Module, <Role 1>, <Role 2>, … <Role N>[, PrivilegeDescription]
```

| Column | Meaning |
|---|---|
| `NLine` | Row number (do not change). Not a continuous run — **`445` is intentionally absent** (a quirk of the SQL that generates both this file and the master list); every future config file inherits the same gap. |
| `PrivilegeName` | Privilege name. **Leading spaces matter** — they encode parent/child nesting; do not strip them. |
| `Module` | Module the privilege belongs to. **Validated** against the master list. |
| *(role columns)* | One column per role. Header = role name. Cell = `Yes` or `---`. **Any number of these, in any order**, after `Module`. |
| `PrivilegeDescription` | **Optional** — kept for compatibility with `Roles Config.csv`; not required. If present, must be the **last** column. Informational, not validated (`NULL` on section rows). |

Cell rules:
- On a real privilege row: exactly `Yes` (enable) or `---` (disable).
- On a section-header row (no module, e.g. `Adherence`): leave role cells
  blank — there is no checkbox there.
- Do not add, remove, reorder, or rename privilege rows, and do not rename
  `NLine` / `PrivilegeName` / `Module` (or `PrivilegeDescription`, if you
  include it). The extension rejects the file if `NLine` + `PrivilegeName` +
  `Module` don't match the
  built-in master list **in exact order** (this protects you from an
  out-of-date list).
- Role-column headers must be non-empty and unique.
- Save as CSV (UTF-8). Excel's default CSV export is fine.

> The file is applied exactly as written. If a role marks a child `Yes` and
> its parent `---`, Verint's own UI will enable the parent when the child is
> ticked — the extension does not pre-resolve or override that. For a CSV that
> exactly equals the saved role, mark required parents `Yes` yourself.

---

## 4. Importing a role (create / overwrite)

1. Sign in to Verint LAB and go to **User Management → Security → Roles
   Setup**. Select the **organization** whose roles you're working with in the
   left-pane tree (this is the owner org the extension will use).
2. Click the **Verint Role Builder** toolbar icon, then click **Import** on
   the mode-select screen.
3. The OS **file picker opens immediately** (no intermediate "Upload" button)
   — the popup shows an instructional line and dispatches the dialog for
   you. The extension first checks you are on the Roles Setup page. **If
   you are not, it shows "Open User Management → Security → Roles Setup,
   then retry" and stops** — it does not parse the file and never
   navigates for you. **Cancelling the picker returns to the
   Export/Import mode-select screen** so you can pick a different mode
   without reopening the popup.
4. **Validation runs silently on success.** Only errors are reported, and
   every error line is prefixed with the file name so it's obvious which
   file failed. Structural problems vs. the master list block everything
   until fixed.
5. **Pick a role column** from the dropdown of roles discovered in the file.
   Below the dropdown, a **Save as role name** input is pre-filled with the
   column header — edit it to save the role under a different name (e.g. to
   clone a role under a new name from an existing CSV column). The input
   follows the dropdown until you edit it; after that it keeps your value.
   You can **Cancel** here and nothing happens.
6. The extension shows the **owner organization** it read from the page.
   Confirm it (or cancel).
7. The extension checks whether **the target role name** exists under that
   org (matched by both the role name and the grid's Owner Organization
   column):
   - **Exists** → "Overwrite role *X* under *Org*? **Yes / No**". No = stop.
     If that role is a **Default Role** or an **Is-Admin** role, a second,
     risk-named confirmation is required before it proceeds.
   - **Not found** → the extension proceeds silently to create the role
     under the confirmed org (no extra confirmation; the owner-org confirm
     in step 6 already gated this).
8. On **Yes**, the extension expands the privilege tree and makes the role
   **exactly match** the chosen column: every `Yes` privilege on, **everything
   else off** — including any privileges the role currently has that the CSV
   does not mark `Yes` (strict mirror). Then it saves and re-verifies.
9. Read the **result**: pass/fail and exactly which privileges changed,
   including any CSV `Yes` privilege whose checkbox doesn't exist in this
   environment (reported as skipped). Verification re-reads every checkbox; a
   failure lists the off-target privileges and does **not** leave a half-saved
   role (save is the single commit point).

Re-running the same file/role is safe and idempotent: the second run reports
"0 changes".

---

## 5. Exporting a role

Export captures the current privileges of one existing role into a CSV file
shaped like `Role Export Sample.csv`.

1. On the Roles Setup page, navigate so the role you want to export is
   visible in the right-pane grid (selecting an organization on the left,
   or using any built-in filter, controls what the grid shows).
2. Click the **Verint Role Builder** toolbar icon → **Export**.
3. A dropdown appears listing all roles currently shown on the Roles Setup
   page. Pick one.
4. Click **Export** in the dialog. The extension opens the role's editor,
   reads every privilege checkbox, then cancels the editor (no change is
   saved — export is read-only).
5. The browser's standard **Save As** dialog opens with the proposed file
   name:
   ```
   Verint Role Export_<role-name>_YYYY-MM-DD.csv
   ```
   Pick any folder and confirm. Characters that are not legal in a Windows
   filename (`/ \ : * ? " < > |`) are replaced with `_`.

### Output schema

The CSV has the same row order as the embedded master privilege list
(`Privilege Config List.csv`), so you can round-trip an export back through
the importer by promoting the role column into a `Roles Config.csv`. Header:

```
NLine, PrivilegeName, Module, <role name>
```

| Column | Meaning |
|---|---|
| `NLine` | Master row number (same gaps as the master — `445` is absent). |
| `PrivilegeName` | Privilege name with leading-space hierarchy preserved. |
| `Module` | Module the privilege belongs to. Blank on section-header rows. |
| `<role name>` | `Yes` if the checkbox is on in the live form, `---` if off. Blank on section-header rows. |

What's **not** in the export: ~20 "live-extra" checkboxes that Verint
manages via module bundles / license-gated cascades (they have no row in the
master). The sample `Role Export Sample.csv` is shaped the same way — the
master is the canonical row set.

### Safety

Export never writes to Verint. The role editor is opened in view-mode, the
checkboxes are read, then **Cancel** returns to the grid. No "Save changes?"
prompt should appear; if one does, click *No*.

---

## 6. What gets set when a role is created

Create Role opens the **same role form as edit**, just empty (there is no
separate dialog). The CSV only carries the privilege matrix, so the extension
sets fixed values — it never asks you:

- **Role Name** — the role you picked.
- **Owner Organization** — the org confirmed in step 6 (it follows the Roles
  Setup left-pane selection; there is no owner-org field to fill).
- **Description** — a copy of the role name.
- **Is-Admin** — left unchecked.
- **Modules** — not set; Verint derives modules from the enabled privileges
  (there is no Modules field).

(For an **overwrite**, none of this applies — only the privilege checkboxes
are changed.)

---

## 7. Safety & limits

- **Every action is gated.** Role pick, owner-org confirm, and
  overwrite/create are all explicit; cancel/no = no change.
- **Session timeout (~5 min idle).** If your Verint session expires mid-run,
  the extension aborts *before* saving and asks you to re-authenticate; your
  uploaded file and role pick are remembered.
- **One role at a time.** Concurrent runs are refused.
- **LAB first.** Validated only against LAB `ZZ_CLAUDE_TEST_*` sandbox roles.
  Using it on a real role changes every user assigned to it immediately —
  treat as a deliberate, approved action.
- **No credential handling.** If you land on the Verint sign-in page the
  extension stops and reports "not logged in".

---

## 8. Troubleshooting

| Symptom | Likely cause / fix |
|---|---|
| "For extension to work, open it on the 'Roles Setup' page." | You clicked Export/Import while not on the Roles Setup page. Navigate to **User Management → Security → Roles Setup** and click the popup button again. |
| Export dropdown is empty | The Roles Setup grid is currently empty. Adjust the left-pane org selection (or any grid filter) so roles are visible, then reopen Export. |
| Export ran but no Save As dialog | Chrome's downloads UI is suppressed. Check `chrome://downloads` — the file still arrives in your default downloads folder. |
| "Structure does not match master list" | Privilege rows added/removed/reordered/renamed, or a changed `NLine`/`PrivilegeName`/`Module`/header. Re-derive from the master list. Error lines are prefixed with `[<file name>]` to identify which upload failed. |
| "Could not find role columns" | Header doesn't start with `NLine,PrivilegeName,Module,…` (with at least one role column after `Module`), or duplicate/empty role-column names. |
| "Cell must be Yes or ---" | A role cell on a privilege row has another value. Fix the listed rows. |
| Wrong owner org shown | The wrong organization is selected in the Roles Setup left-pane tree. Select the right one and reopen the popup. |
| "Role not found" but it exists | It exists under a *different* org. Select that org in the left pane and retry. |
| "Editor not open / 0 checkboxes" | The role editor frame didn't load. Open the role's editor and retry. |
| "Session expired" | Re-log in, reopen the popup, continue (file + role pick retained). |

---

## 9. Glossary

- **Privilege** — one Verint permission; one checkbox in the role editor.
- **Role column** — one column in the CSV after `Module` (and before
  `PrivilegeDescription` if that column is present); its header is the role
  name.
- **Owner organization** — the org a role belongs to; resolved from the Roles
  Setup left-pane selection.
- **Parent/child** — `View X` is the parent of `Edit X`/`Configure X`;
  enabling the child requires the parent.
- **`ZZ_CLAUDE_TEST_*`** — naming convention for disposable LAB test roles.
