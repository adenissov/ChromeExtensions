# 311 Integration Request Validator

A Chrome extension for Salesforce that automatically formats JSON content and validates fields in Integration Request records.

## Features

- **Auto-formatting**: JSON content is automatically formatted when the page loads or when switching between tabs
- **Manual trigger**: Click the extension icon to manually trigger formatting
- **Field validation**: Validates field values using regex patterns and conditional rules
- **Visual feedback**: Color-coded validation results
  - **Green**: Valid field value
  - **Red (bold)**: Invalid field value
  - **Black**: Field not subject to validation
- **Error summary**: Validation errors are displayed at the top of the JSON content

## Installation

1. Open Chrome and navigate to `chrome://extensions/`
2. Enable **Developer mode** (toggle in the top-right corner)
3. Click **Load unpacked**
4. Select this extension folder
5. The extension icon will appear in the Chrome toolbar

## Usage

### Automatic Formatting
Navigate to a Salesforce Integration Request page (`staff-cms.lightning.force.com/lightning/r/*`). The extension will automatically:
1. Detect "HTTP Request Content" sections
2. Parse and format the JSON content
3. Validate fields according to configured rules
4. Display formatted JSON with color-coded validation results

### Manual Trigger
Click the extension icon in the toolbar to manually trigger formatting on the current page.

## Validation Rules

The extension includes the following validation rules:

### Regex-based Rules

| Fields | Rule | Error Message |
|--------|------|---------------|
| `response`, `problemTypeDescription`, `additionalInformation` | No special characters `{}[]\|\`~` | Contains invalid characters |
| `firstName`, `lastName` | Valid name format (letters, numbers, common punctuation) | Invalid name format |
| `country`, `province`, `city`, `streetNumberAndSuffix` | Valid location format | Invalid location format |
| `primaryContactNumber`, `secondaryContactNumber`, `fax` | Valid phone number format | Invalid phone number format |
| `email` | Valid email format | Invalid email format |

### Conditional Rules (Cross-field Validation)

| Condition | Validation | Error Message |
|-----------|------------|---------------|
| `division` = "Toronto Water" | `firstName` ≤ 30 characters | First name for Toronto Water is longer than 30 characters |
| `division` = "Toronto Water" | `lastName` ≤ 50 characters | Last name for Toronto Water is longer than 50 characters |

## Adding Custom Validation Rules

Edit the `validationRules` array in `content.js` to add new validation rules.

### Regex Rule Example
```javascript
{
    type: 'regex',
    fields: ['fieldName1', 'fieldName2'],
    pattern: /^[a-zA-Z]+$/,
    message: 'Must contain only letters'
}
```

### Conditional Rule Example (Cross-field Validation)
```javascript
{
    type: 'conditional',
    condition: (obj) => obj.someField === 'SpecificValue',
    validate: (obj) => {
        // Return true if valid, false if invalid
        return obj.dependentField.length <= 50;
    },
    fields: ['dependentField'],
    message: 'Error message when validation fails'
}
```

### Custom Rule Example
```javascript
{
    type: 'custom',
    validate: (obj) => {
        // Custom logic returning true/false
        return someComplexValidation(obj);
    },
    affectedFields: ['field1', 'field2'],
    message: 'Custom validation failed'
}
```

## Project Structure

```
├── manifest.json          # Extension configuration
├── content.js             # Main logic (formatting, validation, auto-trigger)
├── background.js          # Service worker (icon click handler)
├── options.html           # Options page UI
├── options.js             # Options page logic
├── README.md              # This file
└── images/
    ├── integration_request_validator_icon16.png   # 16×16 toolbar icon
    ├── integration_request_validator_icon32.png   # 32×32 icon
    ├── integration_request_validator_icon48.png   # 48×48 extensions page icon
    ├── integration_request_validator_icon128.png  # 128×128 Chrome Web Store icon
    └── integration_request_validator_icon_orig.png # Original source icon
```

## Technical Details

### Architecture
The extension uses a **two-pass validation architecture**:
1. **Validation Pass**: Traverses the entire JSON object and validates all fields, storing results in a Map
2. **Rendering Pass**: Formats the JSON and applies color-coding based on pre-computed validation results

This approach enables cross-field validation where one field's value can affect another field's validation.

### Auto-trigger Mechanism
- **Page Load**: Processes sections 500ms after the content script loads
- **Tab Switch Detection**: Uses event delegation to detect tab clicks
- **MutationObserver**: Watches for dynamically loaded "HTTP Request Content" sections
- **Debouncing**: Multiple events within 300ms are consolidated into a single processing call

### Permissions
- `activeTab`: Access to the current tab
- `storage`: Store extension settings
- `scripting`: Inject scripts into pages
- `tabs`: Send messages between scripts

## Version History

**v2.3** - Current stable release
- Auto-formatting on page load and tab switch
- One-click manual trigger via extension icon
- Cross-field validation support
- Toronto Water division-specific rules

## License

This extension is for internal use.
