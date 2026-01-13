// Middleware Log Search - Jaeger Accordion Auto-Expand
// Automatically expands span bars, Logs accordion and inner timestamp sections

//=============================================================================
// AUTO-EXPAND JAEGER UI ELEMENTS
//=============================================================================

(function() {
  'use strict';

  let spanBarExpanded = false;

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

    const observer = new MutationObserver((mutations) => {
      // Try to expand span bar if not yet done
      if (!spanBarExpanded) {
        expandSpanBar();
      }

      // Check if any AccordianLogs or detail-row appeared
      const hasNewContent = mutations.some(mutation => {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === Node.ELEMENT_NODE) {
            if (node.classList?.contains('AccordianLogs') || 
                node.querySelector?.('.AccordianLogs') ||
                node.classList?.contains('detail-row') ||
                node.querySelector?.('.detail-row')) {
              return true;
            }
          }
        }
        return false;
      });

      if (hasNewContent) {
        // Small delay to let the DOM settle
        setTimeout(expandLogsAccordions, 100);
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
