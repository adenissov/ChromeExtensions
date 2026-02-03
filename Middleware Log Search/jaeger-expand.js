// Middleware Log Search - Jaeger Accordion Auto-Expand
// Automatically expands span bars, Logs accordion and inner timestamp sections

//=============================================================================
// AUTO-EXPAND JAEGER UI ELEMENTS
//=============================================================================

(function() {
  'use strict';

  let spanBarExpanded = false;
  let responseBodyExtracted = false;
  let extractionAttempts = 0;
  let noRecordsMessageSent = false;
  const MAX_EXTRACTION_ATTEMPTS = 5;

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
      const parsed = JSON.parse(rawValue);
      // Check for errorInfo array with errorMessage
      if (parsed.errorInfo && Array.isArray(parsed.errorInfo) && parsed.errorInfo.length > 0) {
        const errorMessage = parsed.errorInfo[0].errorMessage;
        if (errorMessage) {
          console.log('[Middleware Log] Extracted errorMessage from JSON:', errorMessage);
          return errorMessage;
        }
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
   * Send "no records" message to background script
   */
  function sendNoRecordsMessage() {
    if (noRecordsMessageSent || responseBodyExtracted) return;
    noRecordsMessageSent = true;

    try {
      chrome.runtime.sendMessage({
        action: 'responseBodyExtracted',
        responseBody: 'No records in Middleware log'
      });
      console.log('[Middleware Log] No records message sent to background');
    } catch (error) {
      console.log('[Middleware Log] Failed to send no records message:', error.message);
    }
  }

  /**
   * Check if the Jaeger page has no trace records
   * @returns {boolean} True if no records detected
   */
  function hasNoRecords() {
    // Check for "No trace found" or similar empty state messages
    const noTraceMessage = document.querySelector('.TraceTimelineViewer--noData, .no-data, [data-testid="no-traces"]');
    if (noTraceMessage) return true;

    // Check if there are no span rows at all (empty trace)
    const spanRows = document.querySelectorAll('.span-row, .SpanBarRow');
    if (spanRows.length === 0) {
      // Also check if the trace timeline viewer is present but empty
      const timelineViewer = document.querySelector('.TraceTimelineViewer, .trace-page-timeline');
      if (timelineViewer) return true;
    }

    return false;
  }

  /**
   * Attempt to extract response body with retry logic
   */
  function attemptExtraction() {
    if (responseBodyExtracted || noRecordsMessageSent) return;

    extractionAttempts++;
    console.log('[Middleware Log] Extracting response.body... (attempt', extractionAttempts + '/' + MAX_EXTRACTION_ATTEMPTS + ')');

    const responseBody = extractResponseBody();
    if (responseBody) {
      responseBodyExtracted = true;
      console.log('[Middleware Log] Response body found:', responseBody);
      sendResponseBodyToBackground(responseBody);
    } else if (extractionAttempts < MAX_EXTRACTION_ATTEMPTS) {
      // Retry after delay
      setTimeout(attemptExtraction, 500);
    } else {
      console.log('[Middleware Log] Response body not found after', MAX_EXTRACTION_ATTEMPTS, 'attempts');
      // Send "no records" message instead of letting it timeout
      sendNoRecordsMessage();
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
    setTimeout(attemptExtraction, 300);
  }

  /**
   * Set up MutationObserver to watch for dynamically loaded content
   */
  function setupObserver() {
    console.log('[Middleware Log] Setting up MutationObserver for Jaeger UI');

    // Try to expand span bar after a short delay (wait for virtualized content)
    setTimeout(() => {
      expandSpanBar();
    }, 500);

    // Check for no records after page has had time to load
    setTimeout(() => {
      if (!responseBodyExtracted && !noRecordsMessageSent) {
        if (hasNoRecords()) {
          console.log('[Middleware Log] No records detected on Jaeger page');
          sendNoRecordsMessage();
        }
      }
    }, 2000);

    const observer = new MutationObserver((mutations) => {
      // Try to expand span bar if not yet done
      if (!spanBarExpanded) {
        expandSpanBar();
      }

      // Check if any AccordianLogs, detail-row, or KeyValueTable appeared
      let hasNewAccordion = false;
      let hasKeyValueTable = false;

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
                node.querySelector?.('.KeyValueTable--row')) {
              hasKeyValueTable = true;
            }
          }
        }
      }

      if (hasNewAccordion) {
        // Small delay to let the DOM settle
        setTimeout(expandLogsAccordions, 100);
      }

      if (hasKeyValueTable && !responseBodyExtracted) {
        // KeyValueTable appeared, try to extract response body
        setTimeout(attemptExtraction, 200);
      }
    });

    // Observe the entire document for added nodes
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });

    // Stop observing after 5 minutes
    setTimeout(() => {
      observer.disconnect();
      console.log('[Middleware Log] Observer disconnected after timeout');
    }, 300000);
  }

  // Run when DOM is ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupObserver);
  } else {
    setupObserver();
  }

})();
