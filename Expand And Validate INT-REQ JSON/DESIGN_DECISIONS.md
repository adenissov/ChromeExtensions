# Design Decisions - JSON Validation Refactoring

## Project Context
Chrome extension for Salesforce Integration Request pages that:
1. Formats unformatted JSON (request headers and body)
2. Validates JSON fields against business rules
3. Highlights validation results in the formatted JSON:
   - **Valid fields**: Green highlighting (fields that were validated and passed)
   - **Invalid fields**: Red highlighting (fields that failed validation)
   - **Unvalidated fields**: Black (default color, no validation rules applied)
4. Displays validation errors in a dedicated error list above the JSON body with "*** INVALID" marker

## Problem Statement
The current implementation cannot support cross-field validation rules. Specifically, the requirement to "check field B's value boundaries when field A matches a specific value" is impossible to implement because:
- Each field is validated in isolation during rendering
- The `validateField(key, value)` function only receives individual field name and value
- No access to parent object, sibling fields, or complete JSON structure

## Current Architecture Analysis

### Existing Flow
1. JSON is parsed from Salesforce page
2. `JSON.stringify()` with custom replacer walks the object tree
3. During traversal, `appendFormattedJsonItem()` is called for each leaf field
4. `validateField(key, value)` validates individual fields using regex patterns
5. Validation results determine color coding and error list generation

### Current Limitations
- **Tight coupling**: Validation logic intertwined with rendering logic
- **Field-level only**: Cannot validate relationships between fields
- **Hard-coded rules**: Switch statement requires code changes for new rules
- **No context**: Validator cannot see surrounding data structure
- **Single-pass**: Validation and rendering happen simultaneously

## Alternatives Considered

### Option 1: Pass Entire Object to validateField()
**Approach**: Modify `validateField(key, value, parentObject)` to receive the complete JSON object.

**Pros**:
- Minimal code changes
- Quick to implement
- Enables cross-field validation

**Cons**:
- Still tightly coupled (validation during rendering)
- Difficult to track field paths in nested objects
- Hard to maintain as complexity grows
- Doesn't solve the fundamental architecture problem
- Switch statement still grows unmanageably

**Verdict**: ❌ **Rejected** - Only addresses symptoms, not root cause

---

### Option 2: Two-Pass Architecture with Validation Rule Engine
**Approach**: Separate validation from rendering into two distinct phases:
1. **Validation Pass**: Pre-process entire JSON, run all rules, store results by field path
2. **Rendering Pass**: Format JSON and apply validation results during rendering

**Pros**:
- Clean separation of concerns
- Validators have full object context
- Easy to add new validation rules
- Testable in isolation
- Supports simple and complex validation scenarios
- Scalable architecture

**Cons**:
- Requires significant refactoring
- More complex implementation initially
- Need to track field paths through nested structures

**Verdict**: ✅ **Selected** - Best long-term solution

---

### Option 3: Keep Current Architecture, Use Global State
**Approach**: Store the entire JSON object in a closure-scoped variable accessible to `validateField()`.

**Pros**:
- Minimal changes to function signatures
- Enables cross-field validation

**Cons**:
- Relies on global state (error-prone)
- Still doesn't solve path tracking for nested objects
- Validation still happens during rendering
- Difficult to debug and maintain
- Poor separation of concerns

**Verdict**: ❌ **Rejected** - Creates more technical debt

---

### Option 4: Validate After Rendering
**Approach**: Render first, then walk the DOM to apply validation highlighting.

**Pros**:
- Complete separation of rendering and validation
- Can validate with full context

**Cons**:
- Requires mapping DOM elements back to JSON paths
- Complex error message generation
- Inefficient (two full tree traversals)
- Difficult to correlate DOM nodes with JSON structure

**Verdict**: ❌ **Rejected** - Overly complex, inefficient

---

## Chosen Solution: Two-Pass Architecture

### Architecture Overview

```
┌─────────────────────────────────────────────────────┐
│ Phase 1: VALIDATION PASS                            │
│ ───────────────────────────────────────             │
│ 1. Parse JSON from Salesforce page                  │
│ 2. Run validation rule engine on entire object      │
│ 3. Store results in validationResultsMap            │
│    Key: field path (e.g., "customer.address.city")  │
│    Value: { isValid, message, fieldName, value }    │
└─────────────────────────────────────────────────────┘
                        ↓
┌─────────────────────────────────────────────────────┐
│ Phase 2: RENDERING PASS                             │
│ ───────────────────────────────────────             │
│ 1. Walk JSON structure for formatting               │
│ 2. For each field, lookup validation result         │
│ 3. Apply color coding based on result               │
│ 4. Generate error list from validation results      │
└─────────────────────────────────────────────────────┘
```

### Key Components

#### 1. Validation Rule Engine
**Purpose**: Define validation rules as data structures instead of code

```javascript
const validationRules = [
    // Single-field regex validation
    {
        type: 'regex',
        fields: ['firstName', 'lastName'],
        pattern: /^[a-zA-Z0-9_]+.../,
        message: 'Invalid name format'
    },
    
    // Cross-field conditional validation
    {
        type: 'conditional',
        condition: (obj) => obj.fieldA === 'specificValue',
        validate: (obj) => obj.fieldB >= 10 && obj.fieldB <= 100,
        fields: ['fieldA', 'fieldB'],
        message: 'fieldB must be 10-100 when fieldA is specificValue'
    },
    
    // Complex business logic
    {
        type: 'custom',
        validate: (obj) => customBusinessLogic(obj),
        affectedFields: ['field1', 'field2'],
        message: 'Business rule violation'
    }
];
```

#### 2. Field Path Tracking
**Purpose**: Uniquely identify each field in nested structures

- Root object field: `"firstName"`
- Nested object field: `"customer.address.city"`
- Array element: `"items[0].productName"`
- Deep nesting: `"order.items[2].discounts[0].code"`

#### 3. Validation Results Map
**Purpose**: Store validation outcomes for lookup during rendering

```javascript
validationResultsMap = new Map([
    ["firstName", { isValid: true }],
    ["email", { isValid: false, message: "Invalid email format" }],
    ["customer.address.city", { isValid: false, message: "Invalid city" }]
]);
```

#### 4. Modified Rendering Functions
**Purpose**: Lookup validation results instead of performing validation

- `appendFormattedJsonItem()` receives field path parameter
- Looks up result from `validationResultsMap`
- Applies appropriate color coding
- No validation logic in rendering code

### Implementation Strategy

#### Step 1: Add Field Path Tracking
Modify the JSON traversal to build and pass field paths:
- Track parent path as objects/arrays are entered
- Construct full path for leaf nodes
- Handle arrays with index notation

#### Step 2: Create Validation Infrastructure
- Define validation rule data structure
- Implement rule execution engine
- Build `performValidation()` function
- Create field path traversal utility

#### Step 3: Migrate Existing Rules
Convert switch statement regex rules to rule objects:
- Each case becomes a rule entry
- Group similar validations
- Maintain exact same behavior

#### Step 4: Separate Validation from Rendering
- Move `validateField()` call out of `appendFormattedJsonItem()`
- Replace with validation result lookup
- Keep color coding logic identical

#### Step 5: Generate Error List from Results
- Build error messages from validation results map
- Replace inline error message generation
- Maintain "*** INVALID" format

### Trade-offs and Rationale

#### Why Two-Pass Over Single-Pass?
**Decision**: Run complete validation before any rendering

**Rationale**:
- Validation rules need full object context
- Some rules may depend on multiple fields
- Error list should show all errors, not just those encountered so far
- Easier to test and debug when separated

**Trade-off**: Slightly more memory usage (storing validation results), but negligible for typical JSON sizes

#### Why Field Path Tracking?
**Decision**: Use string paths like `"customer.address.city"` as keys

**Rationale**:
- Uniquely identifies any field in nested structure
- Simple string comparison for lookups
- Human-readable for debugging
- Works with Map data structure

**Trade-off**: Must carefully construct paths during traversal, but provides robust field identification

#### Why Rule Engine Over Function Refactoring?
**Decision**: Data-driven rules instead of large function

**Rationale**:
- New rules don't require code changes
- Rules can be externalized (JSON config file in future)
- Easier to test individual rules
- Self-documenting validation requirements
- Supports multiple rule types (regex, conditional, custom)

**Trade-off**: More initial complexity, but exponentially better maintainability

#### Why Map Over Object for Results?
**Decision**: Use `Map` instead of plain object for validation results

**Rationale**:
- Supports any string as key (including "constructor", "__proto__")
- Better performance for frequent lookups
- Clear API (get/set/has methods)
- No prototype chain issues

**Trade-off**: Slightly less familiar than plain objects, but more robust

### Benefits of Chosen Approach

1. **Extensibility**: Adding new validation rules is trivial
2. **Maintainability**: Clear separation between validation and rendering
3. **Testability**: Can test validation rules independently
4. **Flexibility**: Supports simple to complex validation scenarios
5. **Performance**: Only validate once, lookup during rendering
6. **Debuggability**: Validation results visible as data structure
7. **Scalability**: Architecture handles growing rule complexity

### Migration Path

The refactoring can be done incrementally:

1. **Phase 1**: Add infrastructure (no behavior change)
   - Add field path tracking
   - Create validation results map
   - Keep existing validation logic

2. **Phase 2**: Move single-field rules (behavior identical)
   - Convert regex rules to rule objects
   - Run validation pass before rendering
   - Update rendering to use results map

3. **Phase 3**: Add cross-field capabilities (new features)
   - Implement conditional rule type
   - Add requested cross-field validation
   - Test thoroughly

Each phase maintains working code, reducing risk.

### Future Enhancements Enabled

This architecture naturally supports:
- External rule configuration (JSON/YAML file)
- Rule prioritization and ordering
- Async validation (API calls)
- Validation rule reuse across projects
- Dynamic rule enabling/disabling
- Rule-specific error recovery suggestions
- Validation severity levels (error/warning/info)
- Field dependency graphs
- Batch validation optimizations

## Conclusion

The two-pass architecture with validation rule engine provides the best balance of:
- Immediate problem solving (cross-field validation)
- Long-term maintainability
- Extensibility for future requirements
- Clean code architecture
- Reasonable implementation complexity

While it requires more initial refactoring than quick fixes, it establishes a solid foundation that will save significant time and effort as validation requirements continue to evolve.
