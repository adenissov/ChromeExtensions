# 311 Middleware Log Search - Development Plan

## Overview

This document describes the architecture and implementation plan for the "311 Middleware Log Search" Chrome extension. The extension has **two independent features**:

1. **Kibana Log Search** - Context menu to search middleware logs from Salesforce
2. **Jaeger Auto-Expand** - Automatically expand trace details on Jaeger pages

---

## Architecture

### Component Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                         Chrome Extension                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────┐                                                        │
│  │  background.js  │                                                        │
│  │ (Service Worker)│                                                        │
│  ├─────────────────┤                                                        │
│  │ • Create context│                                                        │
│  │   menu (disabled)│                                                       │
│  │ • Update menu   │                                                        │
│  │   enabled state │                                                        │
│  │ • On menu click:│                                                        │
│  │   open Kibana   │                                                        │
│  └────────▲────────┘                                                        │
│           │ message                                                          │
│  ┌────────┴────────┐         ┌─────────────────────────┐                   │
│  │   content.js    │         │   jaeger-expand.js      │                   │
│  │  (Salesforce)   │         │    (All URLs)           │                   │
│  ├─────────────────┤         ├─────────────────────────┤                   │
│  │ • contextmenu   │         │ • MutationObserver      │                   │
│  │   event handler │         │ • Auto-expand span bars │                   │
│  │ • SR validation │         │ • Auto-expand Logs      │                   │
│  │ • Send menu     │         │ • Auto-expand timestamps│                   │
│  │   state updates │         │                         │                   │
│  └─────────────────┘         └─────────────────────────┘                   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 1: Kibana Log Search

### Data Flow

```
User right-clicks SR link
         │
         ▼
┌─────────────────────────┐
│ contextmenu event fires │
│ (content.js)            │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Validation:             │
│ 1. Is it a link?        │
│ 2. Is text 8-9 digits?  │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ Send message to         │
│ background.js:          │
│ { action, isValid,      │
│   srNumber }            │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ background.js updates   │
│ menu enabled state      │
│ Stores srNumber         │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ User clicks menu item   │
└─────────────────────────┘
         │
         ▼
┌─────────────────────────┐
│ background.js builds    │
│ Kibana URL with SR      │
│ Opens in new tab        │
└─────────────────────────┘
```

### Message Protocol

**Content → Background: `updateMenuState`**
```javascript
{
  action: 'updateMenuState',
  isValid: boolean,      // true if all validations pass
  srNumber: string|null  // SR number if valid, null otherwise
}
```

### Kibana URL Template

```javascript
const KIBANA_URL_TEMPLATE = "http://portal.cc.toronto.ca:5601/app/dashboards#/view/c36f5e40-40fe-11ed-a166-53790178ef13?_g=(filters:!(),refreshInterval:(pause:!t,value:0),time:(from:now-30d,to:now))&_a=(query:(language:kuery,query:'NNNNNNNN'),filters:!(),viewMode:view)";
```

---

## Part 2: Jaeger Auto-Expand

### Target HTML Structure

Jaeger UI uses nested expandable sections:

```
SpanBar (green bar)
  └── Detail Panel
       ├── Tags (accordion)
       ├── Process (accordion)  
       └── Logs (accordion)
            └── Timestamp section (e.g., "1.01s")
                 └── KeyValueTable
                      ├── event
                      └── response.body  ← Target content
```

### Auto-Expand Flow

```
Page loads
    │
    ▼
┌─────────────────────────┐
│ Setup MutationObserver  │
│ (jaeger-expand.js)      │
└─────────────────────────┘
    │
    ▼ (500ms delay)
┌─────────────────────────┐
│ Find collapsed span-row │
│ Click span-name to      │
│ expand span bar         │
└─────────────────────────┘
    │
    ▼ (DOM mutation detected)
┌─────────────────────────┐
│ Find AccordianLogs      │
│ Click header if not     │
│ already open            │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│ Find inner timestamp    │
│ accordions, expand each │
└─────────────────────────┘
    │
    ▼
┌─────────────────────────┐
│ response.body visible!  │
└─────────────────────────┘
```

### Key CSS Classes

| Class | Purpose |
|-------|---------|
| `.span-row` | Span bar container row |
| `.span-row.is-expanded` | Expanded span bar |
| `.span-name` | Clickable span name link |
| `.AccordianLogs` | Logs accordion container |
| `.AccordianLogs--header` | Logs accordion toggle |
| `.AccordianLogs--header.is-open` | Expanded Logs accordion |
| `.AccordianKeyValues--header` | Inner timestamp accordion |

---

## File Structure

```
Middleware Log Search/
├── manifest.json       # Extension configuration
├── background.js       # Service worker: menu, Kibana URL
├── content.js          # Salesforce: SR validation
├── jaeger-expand.js    # Jaeger: auto-expand logic
├── README.md           # User documentation
├── PLAN.md             # This file
└── images/             # Extension icons
```

---

## Design Decisions

### DD-1: Separate Content Scripts
**Decision**: Use separate files for Salesforce (`content.js`) and Jaeger (`jaeger-expand.js`).

**Rationale**:
- Different URL patterns and functionality
- Easier to maintain and debug
- Can be enabled/disabled independently

### DD-2: Menu Disabled by Default
**Decision**: Create context menu with `enabled: false` initially.

**Rationale**:
- Clear visual feedback when element is not valid
- Prevents errors from clicking invalid items

### DD-3: MutationObserver for Jaeger
**Decision**: Use MutationObserver instead of fixed retry delays.

**Rationale**:
- Jaeger uses virtualized rendering
- Content loads dynamically on user interaction
- Observer reacts immediately to DOM changes

### DD-4: Run Jaeger Script on All URLs
**Decision**: Use `<all_urls>` pattern for jaeger-expand.js.

**Rationale**:
- Avoids exposing internal server names in source code
- Does nothing harmful on non-Jaeger pages
- User preference to avoid URL patterns

### DD-5: Safe Message Sending
**Decision**: Wrap `chrome.runtime.sendMessage` in try-catch with error handling.

**Rationale**:
- Extension context can be invalidated after reload
- Prevents uncaught errors in content scripts
- Provides helpful message to refresh page

---

## Testing Checklist

### Kibana Log Search
- [ ] Right-click on 8-digit SR link → Menu **enabled**
- [ ] Right-click on 9-digit SR link → Menu **enabled**
- [ ] Right-click on 7-digit number link → Menu **disabled**
- [ ] Right-click on text (not link) → Menu **disabled**
- [ ] Click enabled menu → Kibana opens in new tab
- [ ] Kibana URL contains correct SR number
- [ ] Works in Salesforce production and sandbox
- [ ] Works in iframes

### Jaeger Auto-Expand
- [ ] Page load → Span bar expands automatically
- [ ] Span expanded → Logs accordion expands
- [ ] Logs expanded → Timestamp sections expand
- [ ] response.body visible without manual clicks
- [ ] Non-Jaeger pages → No errors, no action
- [ ] Console shows `[Middleware Log]` debug messages

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Jan 2026 | Initial release with Kibana search and Jaeger auto-expand |
