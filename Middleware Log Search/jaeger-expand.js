// Middleware Log Search - Jaeger Accordion Auto-Expand
// Automatically expands span bars, Logs accordion and inner timestamp sections

//=============================================================================
// AUTO-EXPAND JAEGER UI ELEMENTS
//=============================================================================

(function() {
  'use strict';

  // Only run in the top frame to avoid duplicates
  if (window !== window.top) {
    return;
  }

  let spanBarExpanded = false;
  let responseBodyExtracted = false;
  let extractionAttempts = 0;
  let traceExtractionDelayLogged = false;
  let pageScrollDone = false;
  let innerScrollDone = false;
  const MAX_EXTRACTION_ATTEMPTS = 5;

  // All delays in one place (the orchestration is timer-driven; see setupObserver).
  const TIMERS = {
    SPAN_BAR_DELAY_MS: 500,          // wait for virtualized span rows before expanding
    SCROLL_INITIAL_MS: 500,          // first ByteStream scroll attempt
    EXTRACT_AFTER_ACCORDION_MS: 300, // extract after Logs accordions expand
    EXTRACT_RETRY_MS: 500,           // retry gap between extraction attempts
    INNER_SCROLL_CAP_MS: 5000,       // stop waiting for the "events" line
    EXTRACT_DELAY_LOG_MS: 10000,     // log a diagnostic if nothing extracted yet
    OBSERVER_DISCONNECT_MS: 300000,  // hard cap: stop observing after 5 min
    ACCORDION_SETTLE_MS: 100,        // let the DOM settle after a new accordion appears
    MUTATION_EXTRACT_MS: 200,        // extract shortly after relevant nodes appear
    MUTATION_SCROLL_MS: 200          // scroll shortly after relevant nodes appear
  };

  /**
   * Check if current page is a Jaeger trace page
   * @returns {boolean} True if on a Jaeger page
   */
  function isJaegerPage() {
    const url = window.location.href.toLowerCase();
    // Check URL for Jaeger/tracing indicators
    if (url.includes('jaeger') || url.includes('/trace/') || url.includes('tracing') ||
        url.includes('16686') || url.includes('zipkin')) {
      return true;
    }
    // Check for Jaeger-specific DOM elements
    if (document.querySelector('.TraceTimelineViewer, .TracePage, .TracePageHeader, .span-row, .SpanBar')) {
      return true;
    }
    return false;
  }

  //===========================================================================
  // RESPONSE BODY EXTRACTION
  //===========================================================================

  /**
   * Parse response body and extract error message if JSON
   * @param {string} rawValue - The raw response body value
   * @returns {string} The extracted error message or original value
   */
  function parseResponseBody(rawValue) {
    if (!rawValue) return rawValue;

    try {
      // Same recursive search as the ByteStream path, so both backends behave
      // alike (covers {errorInfo:[{errorMessage}]}, {error:{errorMessage}}, etc.).
      const errorMessage = findErrorMessageDeep(JSON.parse(rawValue));
      if (errorMessage) {
        console.log('[Middleware Log] Extracted errorMessage from JSON:', errorMessage);
        return errorMessage;
      }
    } catch (e) {
      // Not JSON, return as-is
    }

    return rawValue;
  }

  /**
   * Extract response.body value from Jaeger KeyValueTable
   * @returns {string|null} The response body value or null if not found
   */
  function extractResponseBody() {
    // Find rows in KeyValueTable
    const rows = document.querySelectorAll('.KeyValueTable--row, tr');

    for (const row of rows) {
      const keyCell = row.querySelector('.KeyValueTable--keyColumn, td:first-child');
      if (keyCell && keyCell.textContent.trim() === 'response.body') {
        // Value is in second <td>
        const cells = row.querySelectorAll('td');
        const valueCell = cells[1];
        if (valueCell) {
          let rawValue = null;
          // First try to get the full JSON from json-markup div (handles formatted JSON)
          const jsonMarkup = valueCell.querySelector('.json-markup');
          if (jsonMarkup) {
            rawValue = jsonMarkup.textContent.trim();
          } else {
            // Fallback: get text content of the cell
            rawValue = valueCell.textContent.trim();
          }
          console.log('[Middleware Log] Raw response body:', rawValue);
          return parseResponseBody(rawValue);
        }
      }
    }
    return null;
  }

  //===========================================================================
  // BYTESTREAM O11Y EXTRACTION
  //===========================================================================

  /**
   * Recursively search for an "errorMessage" string field anywhere in obj.
   * Returns the first non-empty string value found (DFS), or null.
   */
  function findErrorMessageDeep(obj) {
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.errorMessage === 'string' && obj.errorMessage) return obj.errorMessage;
    const values = Array.isArray(obj) ? obj : Object.values(obj);
    for (const v of values) {
      const found = findErrorMessageDeep(v);
      if (found) return found;
    }
    return null;
  }

  /**
   * Extract payload from ByteStream O11Y trace page.
   * The page renders a JSON document as syntax-highlighted euiCodeBlock__line spans.
   * Target path: data[0]._source.events[name==="response.payload"].attributes.payload
   * If payload is escaped JSON containing an "errorMessage" field (at any depth),
   * returns that errorMessage value. Otherwise returns the raw payload string.
   */
  function extractPayloadFromByteStream() {
    const lines = document.querySelectorAll('.euiCodeBlock__line');
    if (lines.length === 0) return null;

    const jsonText = Array.from(lines).map(l => l.textContent).join('\n');

    try {
      const data = JSON.parse(jsonText);
      const items = Array.isArray(data) ? data : [data];

      for (const item of items) {
        const source = item._source || item;
        const events = source.events;
        if (!Array.isArray(events)) continue;

        for (const event of events) {
          if (event.name !== 'response.payload') continue;
          const payload = event.attributes?.payload;
          if (!payload) continue;

          try {
            const inner = JSON.parse(payload);
            const errorMsg = findErrorMessageDeep(inner);
            if (errorMsg) return errorMsg;
          } catch (e) {}

          return payload;
        }
      }
    } catch (e) {
      console.log('[Middleware Log] ByteStream JSON parse failed:', e.message);
    }
    return null;
  }

  //===========================================================================
  // BYTESTREAM O11Y SCROLL
  //===========================================================================

  function findPayloadPanel() {
    const titles = document.querySelectorAll('span.panel-title');
    for (const t of titles) {
      if (t.textContent.trim() === 'Payload') return t.closest('.euiPanel');
    }
    return null;
  }

  function findEventsLine(panel) {
    const lines = panel.querySelectorAll('.euiCodeBlock__line');
    for (const line of lines) {
      const props = line.querySelectorAll('.token.property');
      for (const p of props) {
        if (p.textContent === '"events"') return line;
      }
    }
    return null;
  }

  function scrollEventsToTopOfFrame(panel, eventsLine) {
    let el = eventsLine.parentElement;
    while (el) {
      const s = getComputedStyle(el);
      if ((s.overflowY === 'auto' || s.overflowY === 'scroll') &&
          el.scrollHeight > el.clientHeight) {
        el.scrollTop += eventsLine.getBoundingClientRect().top - el.getBoundingClientRect().top;
        return;
      }
      if (el === panel) break;
      el = el.parentElement;
    }
  }

  function performByteStreamScroll() {
    const panel = findPayloadPanel();
    if (!panel) return;

    if (!pageScrollDone) {
      panel.scrollIntoView({ block: 'start' });
      pageScrollDone = true;
      // Bound the wait for "events": stop retrying after the cap
      setTimeout(() => { innerScrollDone = true; }, TIMERS.INNER_SCROLL_CAP_MS);
    }

    if (innerScrollDone) return;

    const eventsLine = findEventsLine(panel);
    if (!eventsLine) return;

    scrollEventsToTopOfFrame(panel, eventsLine);
    innerScrollDone = true;
  }

  /**
   * Send extracted response body to background script
   * @param {string} responseBody - The extracted response body
   */
  function sendResponseBodyToBackground(responseBody) {
    if (!responseBody) return;

    try {
      chrome.runtime.sendMessage({
        action: 'responseBodyExtracted',
        responseBody: responseBody
      });
      console.log('[Middleware Log] Response body sent to background:', responseBody);
    } catch (error) {
      console.log('[Middleware Log] Failed to send response body:', error.message);
    }
  }

  /**
   * Attempt to extract response body with retry logic
   */
  function attemptExtraction() {
    if (responseBodyExtracted) return;

    extractionAttempts++;
    console.log('[Middleware Log] Extracting response.body... (attempt', extractionAttempts + '/' + MAX_EXTRACTION_ATTEMPTS + ')');

    const responseBody = extractResponseBody() || extractPayloadFromByteStream();
    if (responseBody) {
      responseBodyExtracted = true;
      console.log('[Middleware Log] Response body found:', responseBody);
      sendResponseBodyToBackground(responseBody);
    } else if (extractionAttempts < MAX_EXTRACTION_ATTEMPTS) {
      // Retry after delay
      setTimeout(attemptExtraction, TIMERS.EXTRACT_RETRY_MS);
    } else {
      console.log('[Middleware Log] Response body not found after', MAX_EXTRACTION_ATTEMPTS, 'attempts');
      // Do not report "No records" from a trace page. The dashboard page is
      // the only reliable place to know that an SR has no middleware rows.
      // Background timeouts handle trace extraction failures.
    }
  }

  //===========================================================================
  // SPAN BAR EXPANSION
  //===========================================================================

  /**
   * Expand the first span bar (green bar) if collapsed
   */
  function expandSpanBar() {
    if (spanBarExpanded) return;

    // Find span rows that are NOT expanded
    const spanRows = document.querySelectorAll('.span-row:not(.is-expanded)');
    
    if (spanRows.length > 0) {
      // Click the span-name link to expand
      const spanName = spanRows[0].querySelector('.span-name');
      if (spanName) {
        console.log('[Middleware Log] Expanding span bar');
        spanName.click();
        spanBarExpanded = true;
        return true;
      }
      
      // Alternative: click the SpanBar itself
      const spanBar = spanRows[0].querySelector('.SpanBar--wrapper');
      if (spanBar) {
        console.log('[Middleware Log] Expanding span bar via SpanBar--wrapper');
        spanBar.click();
        spanBarExpanded = true;
        return true;
      }
    }
    
    return false;
  }

  /**
   * Expand the Logs accordion and inner timestamp sections
   */
  function expandLogsAccordions() {
    // Find all Logs accordion headers
    const logsHeaders = document.querySelectorAll('.AccordianLogs--header');

    for (const header of logsHeaders) {
      // Expand Logs accordion if collapsed
      if (!header.classList.contains('is-open')) {
        console.log('[Middleware Log] Expanding Logs accordion');
        header.click();
      }

      // Find and expand inner timestamp accordions (AccordianKeyValues--header inside AccordianLogs)
      const accordion = header.closest('.AccordianLogs');
      if (accordion) {
        const innerHeaders = accordion.querySelectorAll('.AccordianKeyValues--header');
        for (const innerHeader of innerHeaders) {
          // Check aria-checked attribute (false = collapsed)
          const isExpanded = innerHeader.getAttribute('aria-checked') === 'true';
          if (!isExpanded) {
            console.log('[Middleware Log] Expanding inner timestamp accordion');
            innerHeader.click();
          }
        }
      }
    }

    // Attempt to extract response body after accordions expand
    setTimeout(attemptExtraction, TIMERS.EXTRACT_AFTER_ACCORDION_MS);
  }

  /**
   * Set up MutationObserver to watch for dynamically loaded content
   */
  function setupObserver() {
    console.log('[Middleware Log] Setting up MutationObserver for Jaeger UI');

    // Try to expand span bar after a short delay (wait for virtualized content)
    setTimeout(() => {
      expandSpanBar();
    }, TIMERS.SPAN_BAR_DELAY_MS);

    // Initial attempt at ByteStream scroll (in case content is already rendered)
    setTimeout(performByteStreamScroll, TIMERS.SCROLL_INITIAL_MS);

    // After 10 seconds, log extraction diagnostics but do not send a no-records
    // result. Trace pages can have real records even when payload extraction
    // misses the current DOM shape.
    setTimeout(() => {
      if (!responseBodyExtracted && !traceExtractionDelayLogged) {
        if (isJaegerPage() || extractionAttempts > 0) {
          traceExtractionDelayLogged = true;
          console.log('[Middleware Log] Trace payload not extracted after 10 seconds; leaving result to background timeout. Attempts:', extractionAttempts);
        }
      }
    }, TIMERS.EXTRACT_DELAY_LOG_MS);

    const observer = new MutationObserver((mutations) => {
      // Try to expand span bar if not yet done
      if (!spanBarExpanded) {
        expandSpanBar();
      }

      // Check if any AccordianLogs, detail-row, or KeyValueTable appeared
      let hasNewAccordion = false;
      let shouldAttemptExtraction = false;

      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList?.contains('AccordianLogs') ||
                node.querySelector?.('.AccordianLogs') ||
                node.classList?.contains('detail-row') ||
                node.querySelector?.('.detail-row')) {
              hasNewAccordion = true;
            }
            if (node.classList?.contains('KeyValueTable') ||
                node.querySelector?.('.KeyValueTable') ||
                node.classList?.contains('KeyValueTable--row') ||
                node.querySelector?.('.KeyValueTable--row') ||
                node.classList?.contains('euiCodeBlock__line') ||
                node.querySelector?.('.euiCodeBlock__line')) {
              shouldAttemptExtraction = true;
            }
          }
        }
      }

      if (hasNewAccordion) {
        // Small delay to let the DOM settle
        setTimeout(expandLogsAccordions, TIMERS.ACCORDION_SETTLE_MS);
      }

      if (shouldAttemptExtraction) {
        if (!responseBodyExtracted) setTimeout(attemptExtraction, TIMERS.MUTATION_EXTRACT_MS);
        if (!innerScrollDone) setTimeout(performByteStreamScroll, TIMERS.MUTATION_SCROLL_MS);
      }
    });

    // Observe the entire document for added nodes
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Stop observing after the hard cap
    setTimeout(() => {
      observer.disconnect();
      console.log('[Middleware Log] Observer disconnected after timeout');
    }, TIMERS.OBSERVER_DISCONNECT_MS);
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupObserver);
  } else {
    setupObserver();
  }

})();
