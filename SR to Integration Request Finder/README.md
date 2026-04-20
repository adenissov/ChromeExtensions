# SR Search Integration Requests

A Chrome/Edge extension for City of Toronto 311 staff that provides two key Salesforce productivity features:

1. **SR to IR Finder** - Quick navigation from Service Request to Integration Request via right-click menu
2. **JSON Formatter & Validator** - Auto-formats and validates JSON in Integration Request pages

## Features Overview

| Feature | Trigger | Description |
|---------|---------|-------------|
| **SR to IR Finder** | Right-click on SR number | Searches for and auto-opens the corresponding Integration Request |
| **JSON Formatter** | Automatic / Click icon | Formats JSON and highlights validation errors in INT-REQ pages |

---

## Feature 1: SR to Integration Request Finder

### Purpose

When working with Service Requests in Salesforce, staff often need to view the Integration Request. The manual process involves 7 steps through App Launcher, list views, and filters.

**This extension reduces that to 1-2 clicks**: right-click on SR number → select menu item → auto-opens if single result found.

### How to Use

1. **Right-click** on a Service Request number link (e.g., `08475332` or `08475332 Customer Issue`) in any Salesforce page
2. Select **"SR Search Integration Requests"** from the context menu
3. The extension automatically:
   - Opens the Salesforce global search
   - Enters the search query: `Request|{SR_NUMBER}`
   - **Auto-clicks** the Integration Request if exactly one result is found

### Auto-Click Behavior

| Search Results | Extension Action |
|----------------|------------------|
| **0 results** | Does nothing |
| **1 result** | **Automatically opens** the Integration Request |
| **2+ results** | Does nothing (user must choose) |

### SR Number Validation

The extension validates SR numbers using the `parseSRNumber()` function. Valid SR numbers are:
- 8 or 9 digits (e.g., `08475332` or `084753321`)
- Optionally followed by a space and descriptive text (e.g., `08475332 Customer Issue`)

Only the numeric portion (before any space) is used for the search.

| Input | Menu State | Extracted SR |
|-------|------------|--------------|
| `08475332` | **Enabled** | `08475332` |
| `08475332 Customer Issue` | **Enabled** | `08475332` |
| `084753321` (9 digits) | **Enabled** | `084753321` |
| `08475332ABC` (no space) | Disabled | N/A |
| `ABC08475332` | Disabled | N/A |
| `0847533` (7 digits) | Disabled | N/A |
| `0847533212` (10 digits) | Disabled | N/A |
| Non-link element | Disabled | N/A |

---

## Feature 2: JSON Formatter & Validator

### Purpose

Integration Request pages contain JSON data in "HTTP Request Content" sections that is difficult to read in raw format. This feature:

- **Auto-formats** JSON with proper indentation
- **Validates** field values against business rules
- **Highlights** invalid values in red with error messages

### How to Use

**Automatic:** The formatter runs automatically when you:
- Open an Integration Request page
- Switch tabs within an INT-REQ record

**Manual:** Click the extension icon in the toolbar to trigger formatting.

### Validation Display

- **Green** text = Valid value
- **Red bold** text = Invalid value (with error message shown at top)
- **Black** text = No validation rule for this field

---

## Adding New Validation Rules

The JSON Formatter includes a validation engine that can be extended with new rules. Rules are defined in `content-json-formatter.js` in the `validationRules` array.

### Rule Types

| Type | Use Case | Required Properties |
|------|----------|---------------------|
| `regex` | Pattern match against **every** occurrence of the listed field names | `fields`, `pattern`, `message` |
| `conditional` | Gate on a precondition, then run a single pass/fail that is applied to every matching field | `fields`, `condition`, `validate`, `message` |
| `custom` | Flexible logic. `validate(obj)` returns either a boolean (applied to every field in `rule.fields`, legacy) or an **array of per-path results** (preferred for anything scoped to a specific path) | `validate`, `message` (+ `fields` when returning a boolean) |
| `missing-sibling` | For each element of a named array, flag a sibling field when a required field is missing | `arrayField`, `requiredField`, `flagField`, `message` |

### Rule: Use Path-Specific Validation

**Any rule whose scope depends on a specific object path must use `type: 'custom'` with a per-path array return.** Do not use `regex`, `conditional`, or the boolean form of `custom` for path-scoped validation.

**Why:** those rule types walk the entire JSON tree and apply a single pass/fail to every field that shares the target name. That produces two problems:
1. **Wrong matches** — a rule intended for `participants[i].address.streetSuffix` also flags `location.address.streetSuffix` because they share the field name.
2. **All-or-nothing** — if one participant fails, every other participant's valid field is also painted red.

**How:** return an array of per-path results from `validate(obj)`. Each entry is `{ path, isValid, fieldName, value, message? }`. Only the paths you return are colored, and each is evaluated independently. Build the path string with the same dot-separated form the renderer uses (array indices included), e.g., `participants.0.address.streetSuffix`.

### Adding a Regex Rule

Use for simple pattern validation on one or more fields:

```javascript
{
    type: 'regex',
    fields: ['fieldName1', 'fieldName2'],  // Fields to validate
    pattern: /^[A-Z]{2}\d{4}$/,            // Regex pattern
    message: 'Must be 2 letters followed by 4 digits'
}
```

**Example - Validate postal code format:**
```javascript
{
    type: 'regex',
    fields: ['postalCode'],
    pattern: /^[A-Z]\d[A-Z] \d[A-Z]\d$/,
    message: 'Invalid Canadian postal code format (e.g., M5V 1J2)'
}
```

### Adding a Conditional Rule

Use when validation depends on another field's value:

```javascript
{
    type: 'conditional',
    condition: (obj) => obj.someField === 'SomeValue',  // When to apply
    validate: (obj) => {                                 // Validation logic
        // Return true if valid, false if invalid
        return obj.targetField.length <= 50;
    },
    fields: ['targetField'],  // Fields to highlight if invalid
    message: 'Error message when validation fails'
}
```

**Example - Validate name length for specific division:**
```javascript
{
    type: 'conditional',
    condition: (obj) => obj.division === 'Toronto Water',
    validate: (obj) => {
        if (!obj.participants || !Array.isArray(obj.participants)) return true;
        return obj.participants.every(p => !p.firstName || p.firstName.length <= 30);
    },
    fields: ['firstName'],
    message: 'First name for Toronto Water must be 30 characters or less'
}
```

### Adding a Custom Rule (preferred for path-specific validation)

The `custom` rule type supports two return shapes from `validate(obj)`:

**(a) Array of per-path results — preferred.** Each entry flags exactly one path:

```javascript
{
    type: 'custom',
    validate: (obj) => {
        // Return an array of { path, isValid, fieldName, value, message? }
        // Only the paths you return are colored; each is evaluated independently.
        const results = [];
        // ...build `results` by inspecting obj and its specific paths...
        return results;
    },
    message: 'Fallback message if an entry omits its own message'
}
```

**Example — Street suffix length limit for one division, scoped to `participants[].address.streetSuffix` only:**
```javascript
{
    type: 'custom',
    validate: (obj) => {
        if (obj.division !== 'Municipal Licensing & Standards') return [];
        if (!obj.participants || !Array.isArray(obj.participants)) return [];
        var results = [];
        obj.participants.forEach((p, i) => {
            var suffix = p && p.address ? p.address.streetSuffix : undefined;
            if (typeof suffix !== 'string' || suffix === '') return;
            results.push({
                path: 'participants.' + i + '.address.streetSuffix',
                isValid: suffix.length <= 10,
                fieldName: 'streetSuffix',
                value: suffix
            });
        });
        return results;
    },
    message: 'Street suffix for MLS is longer than 10 characters'
}
```

**(b) Boolean — legacy.** Applied uniformly to every occurrence of every field named in `rule.fields`. Only use this when the rule is genuinely meant to apply to every such field in the payload:

```javascript
{
    type: 'custom',
    validate: (obj) => {
        if (obj.requestType !== 'Emergency') return true;
        return obj.priority === 'High';
    },
    fields: ['priority'],
    message: 'Emergency requests must have High priority'
}
```

### Adding a Missing-Sibling Rule

Use when each element of an array must contain a required field, and the absence of that field should be flagged on a sibling field of the same element:

```javascript
{
    type: 'missing-sibling',
    arrayField: 'intakeAnswers',    // Array whose elements are checked
    requiredField: 'questionPrompt', // Must be present on each element
    flagField: 'response',           // Highlighted red when requiredField is missing
    message: 'Missing "questionPrompt" element in intakeAnswer'
}
```

### Current Validation Rules

| Fields | Rule Type | Validation |
|--------|-----------|------------|
| `response`, `problemTypeDescription`, `additionalInformation` | regex | No `{}[]|\`~` characters |
| `firstName`, `lastName` | regex | Valid name format |
| `country`, `province`, `city`, `streetNumberAndSuffix` | regex | Valid location characters |
| `primaryContactNumber`, `secondaryContactNumber`, `fax` | regex | Valid phone format |
| `email` | regex | Valid email format |
| `firstName` (Toronto Water) | conditional | Max 30 characters |
| `lastName` (Toronto Water) | conditional | Max 50 characters |
| `participants[].address.streetSuffix` (Municipal Licensing & Standards) | custom (path-specific) | Max 10 characters; only flags the participants path, not siblings like `location.address.streetSuffix` |
| `intakeAnswers[].response` | missing-sibling | Flagged red when the element is missing a `questionPrompt` field |

---

## Installation

1. Open Chrome/Edge and navigate to `chrome://extensions/` or `edge://extensions/`
2. Enable **Developer mode**
3. Click **Load unpacked**
4. Select this extension folder
5. The extension icon appears in the toolbar

---

## Project Structure

```
SR to Integration Request Finder/
├── manifest.json               # Extension configuration
├── background.js               # Service worker (context menu + icon click)
├── content.js                  # SR detection and search execution
├── content-json-formatter.js   # JSON formatting and validation
├── README.md                   # This file (user documentation)
├── ARCHITECTURE.md             # Technical architecture details
└── images/
    ├── 311Logo_16.png
    ├── 311Logo_32.png
    ├── 311Logo_48.png
    └── 311Logo_128.png
```

### File Responsibilities

| File | Purpose |
|------|---------|
| `manifest.json` | Extension configuration, permissions, content script registration |
| `background.js` | Creates context menu, handles menu clicks, handles icon clicks |
| `content.js` | Detects SR numbers, executes Salesforce search, auto-clicks results |
| `content-json-formatter.js` | Formats JSON, validates fields, displays errors |

---

## Supported Salesforce Domains

The extension activates on:
- `https://*.salesforce.com/*`
- `https://*.force.com/*`
- `https://*.lightning.force.com/*`

---

## Troubleshooting

### SR to IR Finder Issues

| Problem | Solution |
|---------|----------|
| "Could not find search box" | Ensure you're on a Salesforce Lightning page with visible search |
| Menu item is grayed out | Right-click directly on an 8-9 digit SR number link |
| Search doesn't work twice | Wait 2 seconds between searches (cooldown period) |
| Auto-click not working | Only triggers for exactly 1 result; check console for details |
| "Extension context invalidated" | Refresh the Salesforce page after reloading the extension |

### JSON Formatter Issues

| Problem | Solution |
|---------|----------|
| JSON not formatting | Click extension icon to manually trigger |
| No sections found | Ensure you're on an INT-REQ page with "HTTP Request Content" section |
| Already processed | Formatter skips sections that are already formatted |

### Debugging

Check the browser console (F12) for debug messages:
- `[IR Finder]` - SR to IR Finder messages
- `[JSONFormatter]` - JSON Formatter messages

Key debug messages:
- `[IR Finder] parseSRNumber:` - Shows SR validation details (input, extracted value, valid/invalid)
- `[IR Finder] Valid SR number detected:` - Confirms a valid SR was found
- `[IR Finder] Menu state updated:` - Shows context menu enable/disable status

---

## Version History

| Version | Changes |
|---------|---------|
| **1.2** | Renamed extension to "SR Search Integration Requests" (removed "311" prefix). Context menu item renamed to "SR Search Integration Requests". Icons replaced with 311 Logo PNGs (`311Logo_{16,32,48,128}.png`). SR validation now accepts descriptive text after SR number (e.g., `08475332 Customer Issue`). Refactored to use centralized `parseSRNumber()` function. |
| 1.1 | Added JSON Formatter & Validator (merged from separate extension) |
| 1.0.2 | Auto-click single result feature |
| 1.0.1 | Dynamic context menu enable/disable |
| 1.0.0 | Initial release |
