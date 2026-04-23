# Feature: IBMS/445 Tip Text Appended to SR Display

## Request
When a middleware log record is processed with error code >=400 and <500, and specifically Backend="IBMS" AND Status Code=445, append the following tip to the SR display text:
` ✅Tip:Check Integration Request for validation errors`

## Implementation
Single edit in `background.js` — `responseBodyExtracted` handler, after `displayText` is assembled and before `updateSRDisplay()` is called.

```js
if (pendingStatusCode === 445 && pendingBackendValue === 'IBMS') {
  displayText += ' ✅Tip:Check Integration Request for validation errors';
}
```

The `>=400 && <500` range check is implicit — 445 is always 4xx — so the condition is written as a direct equality check.

## Data flow context
- `pendingStatusCode` and `pendingBackendValue` are set by the `openInBackground` message (sent from `error-trace-click.js` Case 4 — non-success rows)
- The tip is appended only on real Jaeger response bodies; the timeout path, `statusResult` (200/202), and `noRecordsFound` paths are all unaffected

## File changed
`background.js` — lines ~187–190 (responseBodyExtracted handler)
