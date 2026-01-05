# Implementation Plan - JSON Validation Refactoring

## Overview
Refactor the Chrome extension to support cross-field validation rules using a two-pass architecture: (1) validation pass that analyzes the entire JSON object, (2) rendering pass that applies validation results.

## Implementation Phases

### Phase 1: Add Field Path Tracking Infrastructure
**Goal**: Track the complete path to each field during JSON traversal without changing behavior.

#### Changes Required:
1. **Modify `insertJsonObjectIntoText()` function**:
   - Add `fieldPath` parameter (defaults to `""` for root)
   - Build path as objects/arrays are traversed
   - Pass constructed path to `appendFormattedJsonItem()`

2. **Modify `appendFormattedJsonItem()` function**:
   - Add `fieldPath` parameter
   - Log the field path for verification (temporary)
   - No other behavioral changes yet

3. **Path Construction Rules**:
   - Root level field: `"fieldName"`
   - Nested object field: `"parent.child"`
   - Array element: `"arrayName[index]"`
   - Deep nesting: `"level1.level2[0].level3"`

#### Testing:
- Verify paths are correctly constructed for all field types
- Check console logs show expected paths
- Ensure JSON rendering remains identical

---

### Phase 2: Create Validation Infrastructure
**Goal**: Build the validation rule engine and results storage without removing existing validation logic.

#### New Data Structures:

```javascript
// Validation rule definition
const validationRules = [
    {
        type: 'regex',           // Rule type: 'regex', 'conditional', 'custom'
        fields: ['fieldName'],   // Fields this rule applies to
        pattern: /regex/,        // For regex rules
        message: 'Error message' // User-facing error description
    }
];

// Validation results storage
var validationResultsMap = new Map();
// Structure: Map<fieldPath, { isValid: boolean, message?: string, fieldName: string, value: any }>
```

#### New Functions:

```javascript
// Main validation orchestrator
function performValidation(jsonObject) {
    validationResultsMap.clear();
    
    // Run all validation rules
    validationRules.forEach(rule => {
        executeValidationRule(rule, jsonObject);
    });
    
    return validationResultsMap;
}

// Execute a single rule
function executeValidationRule(rule, jsonObject) {
    switch (rule.type) {
        case 'regex':
            executeRegexRule(rule, jsonObject);
            break;
        case 'conditional':
            executeConditionalRule(rule, jsonObject);
            break;
        case 'custom':
            executeCustomRule(rule, jsonObject);
            break;
    }
}

// Traverse JSON to find and validate specific fields
function traverseAndValidate(obj, rule, currentPath = '') {
    // Recursively walk object tree
    // When field matches rule, validate and store result
    // Handle objects, arrays, and primitives
}

// Rule executors for different types
function executeRegexRule(rule, jsonObject) {
    // Find fields matching rule.fields
    // Test against rule.pattern
    // Store results in validationResultsMap
}

function executeConditionalRule(rule, jsonObject) {
    // Check rule.condition(jsonObject)
    // If true, run rule.validate(jsonObject)
    // Store results for rule.fields
}

function executeCustomRule(rule, jsonObject) {
    // Run rule.validate(jsonObject)
    // Store results for rule.affectedFields
}
```

#### Testing:
- Create sample validation rules
- Call `performValidation()` with test JSON
- Verify `validationResultsMap` contains expected results
- Existing validation still works (not yet using new system)

---

### Phase 3: Migrate Existing Validation Rules
**Goal**: Convert all existing switch-case validation logic to rule objects.

#### Rule Migration Mapping:

```javascript
// Old: switch case for firstName/lastName
case "firstName":
case "lastName": boolResult = regexPeopleName.test(value); break;

// New: Rule object
{
    type: 'regex',
    fields: ['firstName', 'lastName'],
    pattern: /^[a-zA-Z0-9_]+(([',. \-][a-zA-Z0-9\-\(\)\*_ ])?[a-zA-Z0-9.\-\(\)\* _]*)*$/,
    message: 'Invalid name format'
}
```

#### Complete Rule Set:

```javascript
const validationRules = [
    {
        type: 'regex',
        fields: ['response', 'problemTypeDescription', 'additionalInformation'],
        pattern: /^[^\{\}\[\]\|\`\~]*$/,
        message: 'Contains invalid characters'
    },
    {
        type: 'regex',
        fields: ['firstName', 'lastName'],
        pattern: /^[a-zA-Z0-9_]+(([',. \-][a-zA-Z0-9\-\(\)\*_ ])?[a-zA-Z0-9.\-\(\)\* _]*)*$/,
        message: 'Invalid name format'
    },
    {
        type: 'regex',
        fields: ['country', 'province', 'city', 'streetNumberAndSuffix'],
        pattern: /^[A-Za-z0-9'&.,:;_/\(\)\* #\-]*$/,
        message: 'Invalid location format'
    },
    {
        type: 'regex',
        fields: ['primaryContactNumber', 'secondaryContactNumber', 'fax'],
        pattern: /^(\+[0-9 ]*)?[(]{0,1}[0-9]{1,4}[)]{0,1}[-\s\.\/0-9 ]*$/,
        message: 'Invalid phone number format'
    },
    {
        type: 'regex',
        fields: ['email'],
        pattern: /^[\w\.-]+@([\w-]+\.)+[\w-]{2,4}$/,
        message: 'Invalid email format'
    }
];
```

#### Testing:
- Verify all rules are correctly converted
- Test with various JSON inputs
- Ensure no fields are missed
- Compare results with old validation logic

---

### Phase 4: Integrate Validation Pass into Rendering Flow
**Goal**: Call validation before rendering and use results during formatting.

#### Changes to Main Processing:

```javascript
// Current location: Around line 257 (before rendering body)
json_tmp_obj = JSON.parse(json_container_in_body.textContent);

// NEW: Add validation pass
validationResultsMap = performValidation(json_tmp_obj);

jsonRootHtmlElement = document.createElement("pre");
JSON.stringify(json_tmp_obj, jsonStringifyReplacer, indentIncrement);
```

#### Changes to `appendFormattedJsonItem()`:

```javascript
// OLD: Call validateField during rendering
var isValueValid = validateField(key, value);

// NEW: Lookup validation result from map
var validationResult = validationResultsMap.get(fieldPath);
var isValueValid = validationResult ? validationResult.isValid : undefined;
```

#### Changes to Error Message Generation:

```javascript
// OLD: Build error message inline
if (isValueValid != undefined && !isValueValid) {
    var validationErrMsg = ('\"' + key + '\": ') + ('\"' + value + '\", ') + "  // *** INVALID";
    validationErrMessages.push(validationErrMsg);
}

// NEW: Extract from validation results
var validationResult = validationResultsMap.get(fieldPath);
if (validationResult && !validationResult.isValid) {
    var validationErrMsg = ('\"' + validationResult.fieldName + '\": ') + 
                          ('\"' + validationResult.value + '\", ') + 
                          "  // *** INVALID" +
                          (validationResult.message ? " - " + validationResult.message : "");
    validationErrMessages.push(validationErrMsg);
}
```

#### Remove Old Validation Function:
- Delete the `validateField(key, value)` function entirely
- All validation logic now in rule engine

#### Testing:
- Verify all validation results are correctly applied
- Check error list displays all violations
- Confirm color coding works (green for valid, red for invalid)
- Test with various JSON structures
- Ensure backward compatibility (same behavior as before)

---

### Phase 5: Add Cross-Field Validation Capability
**Goal**: Implement and demonstrate conditional validation rules.

#### Add Conditional Rule Support:

```javascript
function executeConditionalRule(rule, jsonObject) {
    // Check if condition is met
    if (!rule.condition(jsonObject)) {
        return; // Condition not met, skip validation
    }
    
    // Condition met, validate the dependent fields
    var isValid = rule.validate(jsonObject);
    
    // Store results for all affected fields
    rule.fields.forEach(fieldName => {
        var fieldPath = findFieldPath(jsonObject, fieldName);
        if (fieldPath) {
            validationResultsMap.set(fieldPath, {
                isValid: isValid,
                message: isValid ? undefined : rule.message,
                fieldName: fieldName,
                value: getValueAtPath(jsonObject, fieldPath)
            });
        }
    });
}

// Helper to find field path in object
function findFieldPath(obj, fieldName, currentPath = '') {
    // Recursively search for field and return its path
    // Returns null if not found
}

// Helper to get value at a specific path
function getValueAtPath(obj, path) {
    // Parse path and navigate to field
    // Returns the value at that path
}
```

#### Example Conditional Rule:

```javascript
// Example: If fieldA is "SpecialCase", then fieldB must be between 10 and 100
validationRules.push({
    type: 'conditional',
    condition: (obj) => obj.fieldA === 'SpecialCase',
    validate: (obj) => {
        var val = obj.fieldB;
        return val >= 10 && val <= 100;
    },
    fields: ['fieldB'],  // Field to highlight if validation fails
    message: 'fieldB must be between 10-100 when fieldA is "SpecialCase"'
});
```

#### Testing:
- Create test JSON with various field combinations
- Verify conditional rules only trigger when condition is met
- Check both passing and failing validations
- Ensure error messages are descriptive
- Test with nested fields

---

### Phase 6: Code Cleanup and Optimization
**Goal**: Remove temporary code, optimize performance, add documentation.

#### Cleanup Tasks:
1. Remove debug console.log statements
2. Remove temporary field path logging
3. Clean up commented-out code
4. Ensure consistent code style

#### Documentation:
```javascript
/**
 * Performs validation on the entire JSON object before rendering.
 * Executes all validation rules and stores results for lookup during rendering.
 * 
 * @param {Object} jsonObject - The parsed JSON object to validate
 * @returns {Map} validationResultsMap - Map of field paths to validation results
 */
function performValidation(jsonObject) { ... }

/**
 * Validation rule structure:
 * {
 *   type: 'regex' | 'conditional' | 'custom',
 *   fields: string[],              // Fields this rule validates
 *   pattern: RegExp,               // For regex rules
 *   condition: (obj) => boolean,   // For conditional rules
 *   validate: (obj) => boolean,    // Validation function
 *   message: string                // Error message if validation fails
 * }
 */
```

#### Performance Considerations:
- Validation runs once per JSON object (efficient)
- Map lookups during rendering are O(1)
- Field path construction has minimal overhead
- Consider caching regex objects

#### Testing:
- Full end-to-end testing with real Salesforce data
- Performance testing with large JSON payloads
- Verify no memory leaks
- Test edge cases (empty objects, null values, deeply nested structures)

---

## Implementation Order Summary

1. ✅ **Phase 1**: Field path tracking (1-2 hours)
2. ✅ **Phase 2**: Validation infrastructure (2-3 hours)
3. ✅ **Phase 3**: Migrate existing rules (1-2 hours)
4. ✅ **Phase 4**: Integrate validation pass (2-3 hours)
5. ✅ **Phase 5**: Add cross-field validation (1-2 hours)
6. ✅ **Phase 6**: Cleanup and documentation (1 hour)

**Total Estimated Time**: 8-13 hours

---

## Risk Mitigation

### Potential Issues:
1. **Field path construction errors**: Test thoroughly with nested structures
2. **Performance with large JSON**: Profile and optimize if needed
3. **Regex compatibility**: Ensure patterns work correctly when converted to objects
4. **Array handling**: Verify array index paths work correctly

### Rollback Strategy:
- Each phase maintains working code
- Can stop at any phase and still have functional extension
- Git commits after each phase for easy rollback

---

## Testing Strategy

### Unit Testing (Manual):
- Test each function individually with sample data
- Verify field path construction
- Test each rule type separately
- Validate error message generation

### Integration Testing:
- Test with real Salesforce Integration Request pages
- Verify all existing validations still work
- Test new conditional validation rules
- Check error list and highlighting

### Edge Cases:
- Empty JSON objects: `{}`
- Null/undefined values
- Arrays with mixed types
- Deeply nested structures (5+ levels)
- Special characters in field names
- Very large JSON payloads (10KB+)

---

## Success Criteria

### Functional Requirements:
✅ All existing validation rules work identically
✅ Can add conditional validation rules
✅ Error list shows all violations
✅ Valid fields highlighted green
✅ Invalid fields highlighted red (bold)
✅ JSON formatting unchanged

### Non-Functional Requirements:
✅ No performance degradation
✅ Code is maintainable and documented
✅ Easy to add new validation rules
✅ No breaking changes to existing functionality

---

## Future Enhancements (Post-Implementation)

### Short Term:
- Add more conditional validation rules as needed
- Externalize rules to JSON config file
- Add validation rule enable/disable toggle

### Long Term:
- Support for warning-level validations (yellow highlight)
- Validation rule priority/ordering
- Custom error message templates
- Validation statistics/reporting
- Rule dependency management

---

## Files to Modify

1. **popup.js** (main file):
   - Add field path tracking
   - Add validation infrastructure
   - Migrate validation rules
   - Integrate validation pass
   - Update rendering logic

2. **No new files required** (all changes in popup.js)

---

## Code Review Checklist

Before considering implementation complete:
- [ ] All existing validations produce identical results
- [ ] Field paths correctly constructed for all JSON structures
- [ ] Validation results map populated correctly
- [ ] Error messages match expected format
- [ ] Color coding works (green/red/black)
- [ ] No console errors
- [ ] Performance is acceptable
- [ ] Code is documented
- [ ] No dead code remains
- [ ] Manual testing on real Salesforce pages successful
