# Example: Adding a Conditional Validation Rule

## Scenario
You need to add a validation rule that checks:
- **IF** `fieldA` equals `"SpecialCase"`
- **THEN** `fieldB` must be between 10 and 100

## How to Add the Rule

Open `popup.js` and locate the `validationRules` array (around line 20-50). Add the following rule:

```javascript
const validationRules = [
    // ... existing rules ...
    
    // NEW: Conditional validation example
    {
        type: 'conditional',
        condition: (obj) => obj.fieldA === 'SpecialCase',
        validate: (obj) => {
            var val = obj.fieldB;
            return val >= 10 && val <= 100;
        },
        fields: ['fieldB'],
        message: 'fieldB must be between 10-100 when fieldA is "SpecialCase"'
    }
];
```

## Explanation

### Rule Properties:

- **`type: 'conditional'`** - Indicates this is a conditional validation rule
- **`condition: (obj) => ...`** - Function that receives the entire JSON object and returns true/false
  - Returns `true` if the condition is met (run validation)
  - Returns `false` if the condition is not met (skip validation)
- **`validate: (obj) => ...`** - Validation function that receives the entire JSON object
  - Returns `true` if validation passes
  - Returns `false` if validation fails
- **`fields: ['fieldB']`** - Array of field names that will be highlighted if validation fails
- **`message: '...'`** - Error message displayed in the error list and on hover

## More Complex Examples

### Example 1: Multiple Conditions (AND logic)
```javascript
{
    type: 'conditional',
    condition: (obj) => obj.status === 'Active' && obj.priority === 'High',
    validate: (obj) => obj.assignee && obj.assignee.length > 0,
    fields: ['assignee'],
    message: 'assignee is required for Active High priority items'
}
```

### Example 2: Validating Multiple Fields
```javascript
{
    type: 'conditional',
    condition: (obj) => obj.country === 'USA',
    validate: (obj) => {
        // Both state and zipCode must be present for USA addresses
        return obj.state && obj.state.length === 2 && 
               obj.zipCode && /^\d{5}(-\d{4})?$/.test(obj.zipCode);
    },
    fields: ['state', 'zipCode'],
    message: 'USA addresses require valid state code and ZIP code'
}
```

### Example 3: Nested Field Access
```javascript
{
    type: 'conditional',
    condition: (obj) => obj.customer && obj.customer.type === 'Enterprise',
    validate: (obj) => {
        return obj.customer.accountManager && 
               obj.customer.accountManager.length > 0;
    },
    fields: ['accountManager'],
    message: 'Enterprise customers must have an assigned account manager'
}
```

### Example 4: Range Validation Based on Type
```javascript
{
    type: 'conditional',
    condition: (obj) => obj.productType === 'Subscription',
    validate: (obj) => {
        var months = parseInt(obj.durationMonths);
        return !isNaN(months) && months >= 1 && months <= 36;
    },
    fields: ['durationMonths'],
    message: 'Subscription duration must be between 1 and 36 months'
}
```

### Example 5: Date Comparison
```javascript
{
    type: 'conditional',
    condition: (obj) => obj.hasDeadline === true,
    validate: (obj) => {
        if (!obj.startDate || !obj.endDate) return false;
        var start = new Date(obj.startDate);
        var end = new Date(obj.endDate);
        return end > start;
    },
    fields: ['startDate', 'endDate'],
    message: 'End date must be after start date when deadline is set'
}
```

## How It Works

1. **Validation Pass** (runs before rendering):
   - The `performValidation()` function processes all rules
   - For conditional rules, `condition(obj)` is evaluated first
   - If condition is `true`, `validate(obj)` runs
   - Results are stored in `validationResultsMap` by field path

2. **Rendering Pass**:
   - Each field looks up its validation result from the map
   - Valid fields: Green color
   - Invalid fields: Red color (bold)
   - Unvalidated fields: Black color (default)

3. **Error List**:
   - All fields that failed validation appear in the error list
   - Format: `"fieldName": "fieldValue",  // *** INVALID - message`

## Testing Your Rule

1. Save the changes to `popup.js`
2. Reload the Chrome extension:
   - Go to `chrome://extensions/`
   - Click the reload icon for your extension
3. Navigate to a Salesforce Integration Request page
4. Click the extension button
5. Check that:
   - Fields are colored correctly (green/red/black)
   - Error list shows expected validation failures
   - Error messages are descriptive

## Tips

### Accessing Nested Fields
Use dot notation or optional chaining:
```javascript
// Safe access with checks
condition: (obj) => obj.address && obj.address.country === 'Canada'

// Or check multiple levels
condition: (obj) => {
    return obj.customer && 
           obj.customer.billing && 
           obj.customer.billing.method === 'CreditCard';
}
```

### Handling Arrays
```javascript
condition: (obj) => obj.items && obj.items.length > 5,
validate: (obj) => obj.items.every(item => item.price > 0),
fields: ['items'], // Will highlight the array field
message: 'When order has more than 5 items, all prices must be positive'
```

### Multiple Validation Conditions
You can add multiple conditional rules for the same field with different conditions:
```javascript
// Rule 1: Basic range for standard products
{
    type: 'conditional',
    condition: (obj) => obj.productType === 'Standard',
    validate: (obj) => obj.quantity >= 1 && obj.quantity <= 100,
    fields: ['quantity'],
    message: 'Standard products: quantity must be 1-100'
},
// Rule 2: Different range for bulk products
{
    type: 'conditional',
    condition: (obj) => obj.productType === 'Bulk',
    validate: (obj) => obj.quantity >= 50 && obj.quantity <= 1000,
    fields: ['quantity'],
    message: 'Bulk products: quantity must be 50-1000'
}
```

## Debugging

If your rule isn't working:

1. **Check the console** for errors:
   - Open DevTools (F12)
   - Look for JavaScript errors

2. **Add temporary logging**:
```javascript
{
    type: 'conditional',
    condition: (obj) => {
        console.log('Checking condition for:', obj);
        var result = obj.fieldA === 'SpecialCase';
        console.log('Condition result:', result);
        return result;
    },
    validate: (obj) => {
        console.log('Running validation for:', obj);
        var val = obj.fieldB;
        var result = val >= 10 && val <= 100;
        console.log('Validation result:', result);
        return result;
    },
    fields: ['fieldB'],
    message: 'Test message'
}
```

3. **Verify field names** match exactly (case-sensitive)
4. **Check field path** - nested fields use dot notation: `customer.address.city`

## Need Help?

Refer to:
- `DESIGN_DECISIONS.md` - Architecture rationale
- `PLAN.md` - Implementation details
- `popup.js` - Source code with existing examples
