# Review Notes

## Summary
Overall, the extension is thoughtfully structured and well documented, but there are a few high‑impact issues that could affect reliability and review/security posture. The most important gaps are inconsistent versioning, overly broad permissions and host matching, and the risk of cross‑tab state bleed in the background worker. There are also a few protocol/documentation mismatches and some brittle runtime assumptions that could be tightened for resilience. The recommendations below focus on improving safety, correctness, and maintainability without changing core behavior.

## Top Issues / Risks
1. Versioning mismatch and unclear release state. `manifest.json` reports `1.0` while `README.md` shows history through `1.1`. Align `manifest.json` and `README.md` to avoid confusion during installation and reviews. `manifest.json` `README.md`
2. Overly broad permissions and host coverage. `host_permissions` is `<all_urls>` and `jaeger-expand.js` runs on `<all_urls>`, which increases review scrutiny and risk. Tighten host patterns where possible or document why broad access is required. `manifest.json` `jaeger-expand.js`
3. Cross‑tab state bleed risk. Global variables in `background.js` (`sourceTabId`, `elementId`, `lastValidSRNumber`, `pendingAllItems`) can be overwritten by another tab’s right‑click, causing updates to target the wrong tab. Consider per‑tab state maps keyed by `sender.tab.id`. `background.js`

## Correctness / Behavior Gaps
1. `noErrorsFound` is listed in the protocol but never emitted. Either implement it in `error-trace-click.js` or remove it from documentation. `README.md` `error-trace-click.js`
2. `jaeger-expand.js` uses `responseBodyExtracted` to send “No records”. This mixes control state with data and could complicate future logic. A dedicated action or explicit status flag would be cleaner. `jaeger-expand.js` `background.js`
3. Spinner detection relies on string matching. `content.js` uses `responseBody.includes('Searching')`, which could misfire if a real message includes that word. Prefer an explicit `isSearching` flag. `content.js` `background.js`

## Maintainability / Resilience
1. Hard‑coded Kibana URL. The URL template lives in `background.js` and is not configurable. Consider extracting to a config object or storage to ease future changes. `background.js`
2. DOM selectors are brittle. Kibana/Jaeger selectors rely on class names and data-test-subj values that can change. Add fallback selectors or a visible warning path to ease debugging. `error-trace-click.js` `jaeger-expand.js`
3. Magic timeouts are scattered. Timeouts live in multiple files and are duplicated in docs. Centralize in one config block and reference in `README.md`. `background.js` `error-trace-click.js` `jaeger-expand.js` `README.md`

## Docs / Project Hygiene
1. Permissions justification. Add a short “Why these permissions” section to reduce review friction. `README.md`
2. Add screenshots or a short demo GIF. Improves onboarding and user confidence. `README.md`
3. Clarify supported environments. Note supported browser(s), Kibana/Jaeger versions, and any assumptions about DOM structure. `README.md`
4. Consistent naming. Normalize “Middleware Log” capitalization across docs and UI strings. `README.md` `background.js`
