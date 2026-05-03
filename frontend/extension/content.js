/**
 * DocuMind AI — Content Script
 * F-01/F-02: Auto Document Detection + DOM Text Extraction
 *
 * Strategy:
 *  1. Detect what kind of document page we're on.
 *  2. Extract visible text directly from the DOM.
 *  3. Send both the detection info AND the extracted text to the background
 *     service worker, which uploads it to the backend.
 *
 * This approach works for ALL document types — Google Drive, local files,
 * cloud viewers — because we read what the browser has already rendered.
 */

(() => {
  'use strict';

  const DOCUMENT_EXTENSIONS = [
    '.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls',
    '.txt', '.md', '.csv', '.epub', '.odt',
  ];

  // ─── Detection ────────────────────────────────────────────────

  function detectDocument() {
    const url = window.location.href;

    // 1. Google Workspace
    if (url.includes('docs.google.com/document'))
      return { type: 'google-docs', subtype: 'document', url };
    if (url.includes('docs.google.com/spreadsheets'))
      return { type: 'google-docs', subtype: 'spreadsheet', url };
    if (url.includes('docs.google.com/presentation'))
      return { type: 'google-docs', subtype: 'presentation', url };
    if (url.includes('drive.google.com/file/d/'))
      return { type: 'google-drive', subtype: 'preview', url };

    // 2. Office 365 Online
    if (url.includes('onedrive.live.com') || url.includes('sharepoint.com'))
      return { type: 'office-365', url };
    if (url.includes('word-edit.officeapps.live.com'))
      return { type: 'office-365', subtype: 'word', url };
    if (url.includes('excel.officeapps.live.com'))
      return { type: 'office-365', subtype: 'excel', url };

    // 3. Cloud storage previews
    if (url.includes('dropbox.com') && (url.includes('/preview/') || url.includes('/view/')))
      return { type: 'dropbox-preview', url };
    if (url.includes('box.com') && url.includes('/file/'))
      return { type: 'box-preview', url };

    // 4. Direct file URL
    const pathname = window.location.pathname.toLowerCase();
    for (const ext of DOCUMENT_EXTENSIONS) {
      if (pathname.endsWith(ext))
        return { type: 'direct-file', url, extension: ext };
    }

    // 5. Embedded PDF via <embed>, <object>, or <iframe>
    const embedPdf = document.querySelector(
      'embed[type="application/pdf"], object[type="application/pdf"]'
    );
    if (embedPdf)
      return { type: 'embedded-pdf', url, source: embedPdf.getAttribute('src') || embedPdf.getAttribute('data') };

    const iframes = document.querySelectorAll('iframe');
    for (const iframe of iframes) {
      const src = (iframe.src || '').toLowerCase();
      if (src.endsWith('.pdf') || src.includes('application/pdf'))
        return { type: 'iframe-pdf', url, source: iframe.src };
    }

    // 6. Chrome's native PDF viewer
    if (document.contentType === 'application/pdf')
      return { type: 'native-pdf', url };

    return null;
  }

  // ─── DOM Text Extraction ──────────────────────────────────────

  /**
   * Extract text from Chrome's native PDF viewer.
   * Chrome renders PDFs using a shadow DOM with <span> elements in a textLayer.
   */
  function extractNativePdfText() {
    try {
      // Method 1: Try the shadow DOM of Chrome's PDF viewer
      const pdfViewer = document.querySelector('embed[type="application/pdf"]');
      if (pdfViewer && pdfViewer.shadowRoot) {
        const spans = pdfViewer.shadowRoot.querySelectorAll('.textLayer span');
        if (spans.length > 0) {
          return Array.from(spans).map(s => s.textContent).join(' ');
        }
      }
    } catch (e) {
      console.log('[DocuMind] Shadow DOM access blocked for PDF viewer:', e.message);
    }

    try {
      // Method 2: Try pdf-viewer element (newer Chrome versions)
      const viewer = document.querySelector('pdf-viewer');
      if (viewer) {
        const shadow = viewer.shadowRoot;
        if (shadow) {
          const content = shadow.querySelector('#content');
          if (content) return content.innerText || '';
        }
      }
    } catch (e) {
      console.log('[DocuMind] pdf-viewer access failed:', e.message);
    }

    try {
      // Method 3: Try document body text (sometimes Chrome exposes it)
      const body = document.body;
      if (body) {
        const text = body.innerText || '';
        if (text.length > 50) return text;
      }
    } catch (e) {
      console.log('[DocuMind] body text extraction failed:', e.message);
    }

    return null;
  }

  /**
   * Extract text from Google Docs.
   * Google Docs renders content in elements with class ".kix-page" or ".docs-texteventtarget-iframe".
   */
  function extractGoogleDocsText() {
    // Try the main document content area
    const pages = document.querySelectorAll('.kix-page');
    if (pages.length > 0) {
      return Array.from(pages).map(p => p.innerText).join('\n\n--- PAGE BREAK ---\n\n');
    }

    // Fallback: grab all text from the editor
    const editor = document.querySelector('.kix-appview-editor');
    if (editor) return editor.innerText;

    return null;
  }

  /**
   * Extract text from Google Drive preview.
   * The preview renders pages inside img tags or iframe, but also has a text layer.
   */
  function extractGoogleDriveText() {
    // Try the document viewer text
    const viewer = document.querySelector('.ndfHFb-c4YZDc');
    if (viewer) return viewer.innerText;

    // Try pages
    const pages = document.querySelectorAll('[data-page-number]');
    if (pages.length > 0) {
      return Array.from(pages).map(p => p.innerText).join('\n\n');
    }

    return null;
  }

  /**
   * Generic fallback: just grab all visible text from the page.
   */
  function extractGenericText() {
    // Remove script/style content noise
    const clone = document.body.cloneNode(true);
    clone.querySelectorAll('script, style, nav, header, footer, noscript').forEach(el => el.remove());
    return clone.innerText || '';
  }

  /**
   * Master extraction function: picks the right strategy based on detection type.
   */
  function extractText(detection) {
    let text = null;
    
    // Determine if it's a complex viewer that we should never use generic extraction on
    // (Only block generic extraction for known problematic viewers like Google Drive and PDF viewers)
    const isComplexViewer = (
      detection.type === 'google-drive' ||
      detection.type === 'google-docs' ||
      detection.type === 'native-pdf' || 
      detection.type === 'embedded-pdf' || 
      detection.type === 'iframe-pdf' || 
      (detection.type === 'direct-file' && detection.extension === '.pdf')
    );

    switch (detection.type) {
      case 'native-pdf':
      case 'direct-file':
      case 'embedded-pdf':
      case 'iframe-pdf':
        text = extractNativePdfText();
        break;
      case 'google-docs':
        text = extractGoogleDocsText();
        break;
      case 'google-drive':
        text = extractGoogleDriveText();
        break;
      default:
        break;
    }

    // Fallback: generic DOM text extraction
    if (!text || text.trim().length < 30) {
      if (!isComplexViewer) {
        text = extractGenericText();
      } else {
        return null;
      }
    }

    return text ? text.trim() : null;
  }

  // ─── Main Init ────────────────────────────────────────────────
  let documentSent = false;

  function init() {
    const detection = detectDocument();
    if (!detection) return;

    console.log('[DocuMind] 📄 Document detected:', detection.type);

    // Wait a bit for dynamic content to render (Google Docs, Drive previews)
    const extractionDelay = detection.type.startsWith('google') ? 3000 : 500;

    setTimeout(() => {
      if (documentSent) return;
      
      const text = extractText(detection);

      if (text && text.length >= 30) {
        console.log(`[DocuMind] 📝 Extracted ${text.length} chars of text via DOM`);
        documentSent = true;
        if (typeof observer !== 'undefined') observer.disconnect();
        // Send both detection data AND the extracted text
        chrome.runtime.sendMessage({
          type: 'DOCUMENT_WITH_TEXT',
          data: detection,
          text: text,
          title: document.title || detection.url,
        });
      } else {
        console.log('[DocuMind] ⚠️ Could not extract text, sending detection only');
        documentSent = true;
        if (typeof observer !== 'undefined') observer.disconnect();
        chrome.runtime.sendMessage({
          type: 'DOCUMENT_DETECTED',
          data: detection,
        });
      }
    }, extractionDelay);
  }

  // Run on load
  if (document.readyState === 'complete') {
    init();
  } else {
    window.addEventListener('load', init);
  }

  // MutationObserver for late-loading SPAs
  const observer = new MutationObserver(() => {
    if (documentSent) {
      observer.disconnect();
      return;
    }
    const detection = detectDocument();
    if (detection) {
      observer.disconnect();
      console.log('[DocuMind] 📄 Late detection via MutationObserver:', detection.type);
      setTimeout(() => {
        if (documentSent) return;
        const text = extractText(detection);
        if (text && text.length >= 30) {
          documentSent = true;
          chrome.runtime.sendMessage({
            type: 'DOCUMENT_WITH_TEXT',
            data: detection,
            text: text,
            title: document.title || detection.url,
          });
        } else {
          documentSent = true;
          chrome.runtime.sendMessage({
            type: 'DOCUMENT_DETECTED',
            data: detection,
          });
        }
      }, 1500);
    }
  });

  observer.observe(document.body || document.documentElement, {
    childList: true,
    subtree: true,
  });

  setTimeout(() => observer.disconnect(), 15_000);
})();
