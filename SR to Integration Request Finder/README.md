# 311 SR to Integration Request Finder

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
2. Select **"Search Integration Request"** from the context menu
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
| `regex` | Simple pattern matching on field values | `fields`, `pattern`, `message` |
| `conditional` | Cross-field validation with preconditions | `fields`, `condition`, `validate`, `message` |
| `custom` | Complex custom logic | `fields`, `validate`, `message` |

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

### Adding a Custom Rule

Use for complex validation that doesn't fit other types:

```javascript
{
    type: 'custom',
    validate: (obj) => {
        // Custom validation logic
        // Return true if valid, false if invalid
        return someComplexValidation(obj);
    },
    fields: ['field1', 'field2'],  // Fields to highlight if invalid
    message: 'Custom error message'
}
```

**Example - Validate that emergency requests have high priority:**
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
├── PLAN.md                     # Technical architecture details
└── images/
    ├── sr_to_ir_finder_icon16.png
    ├── sr_to_ir_finder_icon32.png
    ├── sr_to_ir_finder_icon48.png
    └── sr_to_ir_finder_icon128.png
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
| **1.2** | SR validation now accepts descriptive text after SR number (e.g., `08475332 Customer Issue`). Refactored to use centralized `parseSRNumber()` function. |
| 1.1 | Added JSON Formatter & Validator (merged from separate extension) |
| 1.0.2 | Auto-click single result feature |
| 1.0.1 | Dynamic context menu enable/disable |
| 1.0.0 | Initial release |
