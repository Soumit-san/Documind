/**
 * DocuMind AI — Content Script
 * Injected into every page to detect documents and communicate with the service worker.
 */

(() => {
  'use strict';

  const DOCUMENT_MIME_TYPES = [
    'application/pdf',
  ];

  const DOCUMENT_EXTENSIONS = [
    '.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls',
    '.txt', '.md', '.csv', '.epub', '.odt',
  ];

  /**
   * Check if current page is a document viewer (Google Docs, Office 365, etc.)
   */
  function detectDocumentViewer() {
    const url = window.location.href;

    // Google Docs / Sheets / Slides
    if (url.includes('docs.google.com/document') ||
        url.includes('docs.google.com/spreadsheets') ||
        url.includes('docs.google.com/presentation')) {
      return { type: 'google-docs', url };
    }

    // Office 365 Online
    if (url.includes('onedrive.live.com') || url.includes('sharepoint.com')) {
      return { type: 'office-365', url };
    }

    // Direct file URL
    const pathname = window.location.pathname.toLowerCase();
    for (const ext of DOCUMENT_EXTENSIONS) {
      if (pathname.endsWith(ext)) {
        return { type: 'direct-file', url, extension: ext };
      }
    }

    // PDF MIME type detection via <embed> or <object>
    const embedEl = document.querySelector('embed[type="application/pdf"], object[type="application/pdf"]');
    if (embedEl) {
      return { type: 'embedded-pdf', url };
    }

    return null;
  }

  // Run detection after DOM is ready
  function init() {
    const detection = detectDocumentViewer();
    if (detection) {
      chrome.runtime.sendMessage({
        type: 'DOCUMENT_DETECTED',
        data: detection,
      });
    }
  }

  // Run on load
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }
})();
