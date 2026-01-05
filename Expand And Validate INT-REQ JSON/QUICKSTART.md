# Quick Start Guide - Adding Your New Validation Rule

## Your Requirement
You need to add a validation rule that:
- Checks if **field A** has a specific value
- If yes, then **field B** must be within specific boundaries
- If validation fails, the field should be highlighted red and appear in the error list

## Step-by-Step Instructions

### Step 1: Open popup.js
Locate the file:
```
c:\_Alex\2022-01-21 Chrome Extensions\2026-01-05 Chrome Ext Expand JSON Content\popup.js
```

### Step 2: Find the Validation Rules Section
Look for the `validationRules` array around **line 37**. You'll see existing rules like:
```javascript
const validationRules = [
    {
        type: 'regex',
        fields: ['email'],
        pattern: /^[\w\.-]+@([\w-]+\.)+[\w-]{2,4}$/,
        message: 'Invalid email format'
    }
];
```

### Step 3: Add Your New Rule
**Before the closing bracket `];`**, add your new conditional rule:

```javascript
const validationRules = [
    // ... existing rules ...
    
    // YOUR NEW RULE - Replace with actual field names and values
    {
        type: 'conditional',
        condition: (obj) => obj.fieldA === 'YourExpectedValue',  // Replace: fieldA and YourExpectedValue
        validate: (obj) => {
            var val = obj.fieldB;  // Replace: fieldB
            return val >= 10 && val <= 100;  // Replace: 10 and 100 with your boundaries
        },
        fields: ['fieldB'],  // Replace: fieldB (this field will be highlighted red if invalid)
        message: 'fieldB must be between 10-100 when fieldA is YourExpectedValue'  // Replace with descriptive message
    }
];
```

### Step 4: Customize the Rule

Replace these placeholders with your actual values:

1. **`fieldA`** - The field name that triggers the validation
2. **`'YourExpectedValue'`** - The specific value that fieldA must have
3. **`fieldB`** - The field name that will be validated
4. **`10` and `100`** - Your actual boundary values
5. **Error message** - A clear description of the validation rule

### Real Example

Let's say:
- When `orderType` is `"Bulk"`
- Then `quantity` must be between 50 and 1000

Your rule would be:
```javascript
{
    type: 'conditional',
    condition: (obj) => obj.orderType === 'Bulk',
    validate: (obj) => {
        var val = obj.quantity;
        return val >= 50 && val <= 1000;
    },
    fields: ['quantity'],
    message: 'Bulk orders require quantity between 50-1000'
}
```

## Real Examples Already Implemented

The extension already includes working examples of conditional validation:

### Example 1: Toronto Water firstName Length
```javascript
{
    type: 'conditional',
    condition: (obj) => obj.division === 'Toronto Water',
    validate: (obj) => {
        if (!obj.participants || !Array.isArray(obj.participants)) return true;
        return obj.participants.every(p => !p.firstName || p.firstName.length <= 30);
    },
    fields: ['firstName'],
    message: 'First name for Toronto Water is longer than 30 characters'
}
```

### Example 2: Toronto Water lastName Length
```javascript
{
    type: 'conditional',
    condition: (obj) => obj.division === 'Toronto Water',
    validate: (obj) => {
        if (!obj.participants || !Array.isArray(obj.participants)) return true;
        return obj.participants.every(p => !p.lastName || p.lastName.length <= 50);
    },
    fields: ['lastName'],
    message: 'Last name for Toronto Water is longer than 50 characters'
}
```

These rules demonstrate:
- Checking a top-level field (`division`)
- Validating fields inside an array (`participants`)
- Using `.every()` to validate all array elements
- Safe null checking with optional chaining

### Step 5: Save and Reload

1. **Save** `popup.js`
2. **Reload the extension**:
   - Navigate to `chrome://extensions/`
   - Find your extension in the list
   - Click the **reload icon** (🔄)

### Step 6: Test

1. Open a Salesforce Integration Request page
2. Click your extension button
3. Verify:
   - ✅ When fieldA = expected value AND fieldB is within range → Green
   - ✅ When fieldA = expected value AND fieldB is outside range → Red (bold) + error in list
   - ✅ When fieldA ≠ expected value → No validation applied (black)

## Common Scenarios

### Scenario 1: Multiple Conditions (AND)
```javascript
{
    type: 'conditional',
    condition: (obj) => obj.status === 'Active' && obj.priority === 'High',
    validate: (obj) => obj.assignee && obj.assignee.length > 0,
    fields: ['assignee'],
    message: 'Active high-priority items require an assignee'
}
```

### Scenario 2: Multiple Conditions (OR)
```javascript
{
    type: 'conditional',
    condition: (obj) => obj.type === 'TypeA' || obj.type === 'TypeB',
    validate: (obj) => obj.specialField !== null && obj.specialField !== '',
    fields: ['specialField'],
    message: 'specialField is required for TypeA and TypeB'
}
```

### Scenario 3: Nested Fields
```javascript
{
    type: 'conditional',
    condition: (obj) => obj.customer && obj.customer.type === 'Enterprise',
    validate: (obj) => obj.customer.accountManager && obj.customer.accountManager.length > 0,
    fields: ['accountManager'],
    message: 'Enterprise customers must have an account manager'
}
```

### Scenario 4: String Validation
```javascript
{
    type: 'conditional',
    condition: (obj) => obj.requiresApproval === true,
    validate: (obj) => obj.approverEmail && /^[\w\.-]+@([\w-]+\.)+[\w-]{2,4}$/.test(obj.approverEmail),
    fields: ['approverEmail'],
    message: 'Valid approver email required when approval is needed'
}
```

### Scenario 5: Date Comparison
```javascript
{
    type: 'conditional',
    condition: (obj) => obj.hasDeadline === true,
    validate: (obj) => {
        if (!obj.startDate || !obj.endDate) return false;
        return new Date(obj.endDate) > new Date(obj.startDate);
    },
    fields: ['startDate', 'endDate'],
    message: 'End date must be after start date'
}
```

## Troubleshooting

### Rule Not Working?

1. **Check field names are exact** (case-sensitive):
   ```javascript
   // ❌ Wrong: 'OrderType' 
   // ✅ Correct: 'orderType'
   ```

2. **Check the condition logic**:
   ```javascript
   // Add temporary logging
   condition: (obj) => {
       console.log('Checking:', obj.fieldA);
       return obj.fieldA === 'ExpectedValue';
   }
   ```

3. **Verify the field exists in your JSON**:
   - Check the formatted JSON on the page
   - Make sure the field name matches exactly

4. **Check browser console** (F12) for errors

### Field Not Being Highlighted?

- The `fields` array must contain the exact field name(s)
- For nested fields, use just the field name, not the path

### Validation Always Running?

- Check your `condition` function - it might always return `true`
- Add logging to verify when condition is evaluated

## Need More Help?

See detailed examples and debugging tips in:
- **`EXAMPLE_CONDITIONAL_RULE.md`** - Comprehensive examples
- **`DESIGN_DECISIONS.md`** - Architecture explanation
- **`REFACTORING_SUMMARY.md`** - Overview of changes

## Quick Reference

```javascript
// Template for your rule
{
    type: 'conditional',
    condition: (obj) => /* when should this rule apply? */,
    validate: (obj) => /* is the data valid? return true/false */,
    fields: ['fieldToHighlight'],
    message: 'Error message to display'
}
```

**That's it!** You now have cross-field validation working in your Chrome extension. 🎉
