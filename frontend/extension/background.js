/**
 * DocuMind AI — Background Service Worker (Manifest V3)
 * F-01: Auto Document Detection
 *
 * Responsibilities:
 *  1. Detect supported document URLs via file extensions & MIME patterns
 *  2. Listen for content-script-detected documents (Google Docs, Office 365, embedded PDFs)
 *  3. Show a badge on the toolbar icon when a document is detected
 *  4. Auto-open the sidePanel on detection
 *  5. Toggle sidebar via icon click and Alt+D keyboard shortcut
 */

// ─── Supported file types (from PRD §3.2) ───────────────────────────────────
const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls',
  '.txt', '.md', '.csv', '.json', '.yaml',
  '.epub', '.odt', '.odp', '.ods', '.wps',
]);

const SUPPORTED_MIME_PATTERNS = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument',
  'application/vnd.ms-powerpoint',
  'application/vnd.ms-excel',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/epub',
];

// ─── State per tab ──────────────────────────────────────────────────────────
const tabDocState = new Map(); // tabId → { detected: bool, type, url, ... }

// ─── URL-based detection ────────────────────────────────────────────────────
function getDocumentExtension(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    // Strip query/fragment that might leak into pathname
    const clean = pathname.split('?')[0].split('#')[0];
    for (const ext of SUPPORTED_EXTENSIONS) {
      if (clean.endsWith(ext)) return ext;
    }
  } catch { /* ignore invalid URLs */ }
  return null;
}

function isGoogleDocsUrl(url) {
  return /docs\.google\.com\/(document|spreadsheets|presentation)/.test(url) ||
         /drive\.google\.com\/file\/d\//.test(url);
}

function isOffice365Url(url) {
  return /onedrive\.live\.com|sharepoint\.com|office\.com/.test(url);
}

function detectDocumentFromUrl(url) {
  if (!url) return null;

  const ext = getDocumentExtension(url);
  if (ext) return { type: 'direct-file', url, extension: ext };

  if (isGoogleDocsUrl(url)) return { type: 'google-docs', url };
  if (isOffice365Url(url)) return { type: 'office-365', url };

  return null;
}

// ─── Badge management ───────────────────────────────────────────────────────
async function showDocumentBadge(tabId) {
  try {
    await chrome.action.setBadgeBackgroundColor({ tabId, color: '#ffe17c' });
    await chrome.action.setBadgeText({ tabId, text: 'DOC' });
    await chrome.action.setTitle({
      tabId,
      title: 'DocuMind AI — Document detected! Click to analyze.',
    });
  } catch (e) {
    console.warn('[DocuMind] Badge update failed:', e);
  }
}

async function clearDocumentBadge(tabId) {
  try {
    await chrome.action.setBadgeText({ tabId, text: '' });
    await chrome.action.setTitle({ tabId, title: 'DocuMind AI — Click to open sidebar' });
  } catch { /* tab may have closed */ }
}

// ─── SidePanel management ───────────────────────────────────────────────────
// Set the default behavior: clicking the extension icon opens the side panel
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

async function enableSidePanel(tabId) {
  try {
    await chrome.sidePanel.setOptions({
      tabId,
      path: 'sidepanel.html',
      enabled: true,
    });
  } catch (e) {
    console.warn('[DocuMind] SidePanel enable failed:', e);
  }
}

// ─── Core detection handler ─────────────────────────────────────────────────
async function handleDocumentDetected(tabId, detection) {
  // Store state
  tabDocState.set(tabId, { detected: true, ...detection, detectedAt: Date.now() });

  console.log(`[DocuMind] 📄 Document detected on tab ${tabId}:`, detection);

  // Visual feedback
  await showDocumentBadge(tabId);

  // Enable the side panel for this specific tab
  // Note: Chrome blocks auto-opening the side panel without a direct user click.
  // The user will see the badge and can click the icon or press Alt+D.
  await enableSidePanel(tabId);

  // Notify the side panel about the detected document (if it's open)
  try {
    await chrome.runtime.sendMessage({
      type: 'DOCUMENT_READY',
      tabId,
      data: detection,
    });
  } catch { /* side panel may not be listening yet */ }
}

// ─── Tab lifecycle events ───────────────────────────────────────────────────

// 1. Detect on tab navigation complete
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    const detection = detectDocumentFromUrl(tab.url);
    if (detection) {
      await handleDocumentDetected(tabId, detection);
    } else {
      // Clear state for non-document tabs
      tabDocState.delete(tabId);
      await clearDocumentBadge(tabId);
      // Disable side panel for non-document tabs
      chrome.sidePanel.setOptions({ tabId, enabled: false }).catch(() => {});
    }
  }
});

// 2. Clean up on tab close
chrome.tabs.onRemoved.addListener((tabId) => {
  tabDocState.delete(tabId);
});

// ─── Content script messages ────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

  // --- Standard detection (no text extracted) ---
  if (message.type === 'DOCUMENT_DETECTED' && sender.tab?.id) {
    const tabId = sender.tab.id;
    const data = message.data;

    // Try to auto-upload the raw file if it's a PDF or direct file
    const isPdf = data.type === 'native-pdf' || data.type === 'direct-file' || (data.url && data.url.toLowerCase().endsWith('.pdf'));
    
    if (isPdf && data.url) {
      console.log(`[DocuMind BG] Attempting raw file upload for ${data.url}`);
      
      data.uploading = true;
      handleDocumentDetected(tabId, data);
      chrome.runtime.sendMessage({ type: 'DOCUMENT_READY', data }).catch(()=>{});

      chrome.storage.local.get(['supabaseToken'], (result) => {
        const token = result.supabaseToken;
        if (!token) {
          console.error('[DocuMind BG] No auth token found.');
          data.uploading = false;
          data.upload_error = 'Not authenticated. Please log in to the DocuMind Web App.';
          chrome.runtime.sendMessage({ type: 'DOCUMENT_READY', data }).catch(()=>{});
          return;
        }

        fetch(data.url)
          .then(r => {
            if (!r.ok) throw new Error(`HTTP error! status: ${r.status}`);
            return r.blob();
          })
          .then(blob => {
            const formData = new FormData();
            let filename = data.url.split('/').pop().split('#')[0].split('?')[0] || 'document.pdf';
            if (!filename.includes('.')) filename += '.pdf';
            
            formData.append('file', blob, filename);
            
            return fetch('http://127.0.0.1:8000/api/documents/upload', {
              method: 'POST',
              headers: { 'Authorization': `Bearer ${token}` },
              body: formData
            });
          })
          .then(async r => {
            const result = await r.json().catch(() => ({}));
            if (!r.ok || !result.id) throw new Error(result.detail || 'Upload failed');
            return result;
          })
          .then(result => {
            console.log('[DocuMind BG] Raw file uploaded successfully:', result);
            data.uploading = false;
            data.document_id = result.id;
            data.detected = true;
            tabDocState.set(tabId, data);
            chrome.runtime.sendMessage({ type: 'DOCUMENT_READY', data }).catch(()=>{});
          })
          .catch(err => {
            console.error('[DocuMind BG] Raw file upload failed:', err);
            data.uploading = false;
            data.upload_error = err.toString();
            chrome.runtime.sendMessage({ type: 'DOCUMENT_READY', data }).catch(()=>{});
          });
      });
    } else {
      // Cannot auto-upload (e.g. Google Drive preview), and text extraction failed
      data.upload_error = 'Text extraction not supported for this cloud viewer without an extension update. Please upload manually.';
      handleDocumentDetected(tabId, data);
    }
    
    sendResponse({ status: 'ok' });
  }

  // --- Detection WITH extracted DOM text (the main flow now) ---
  if (message.type === 'DOCUMENT_WITH_TEXT' && sender.tab?.id) {
    const tabId = sender.tab.id;
    const data = message.data;

    console.log(`[DocuMind BG] Received ${message.text.length} chars of text from tab ${tabId}`);

    chrome.storage.local.get(['supabaseToken'], (result) => {
      const token = result.supabaseToken;
      if (!token) {
        data.upload_error = 'Not authenticated. Please log in to the DocuMind Web App.';
        chrome.runtime.sendMessage({ type: 'DOCUMENT_READY', data }).catch(()=>{});
        return;
      }

      // Upload the text to the backend
      fetch('http://127.0.0.1:8000/api/documents/upload-text', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: message.text,
          url: data.url,
          title: message.title || 'Untitled Document',
          source_type: data.type,
        }),
      })
      .then(async r => {
        const result = await r.json().catch(() => ({}));
        if (!r.ok || !result.document_id) {
          throw new Error(result.detail || 'Upload failed or missing document_id');
        }
        return result;
      })
      .then(result => {
        console.log('[DocuMind BG] Text indexed:', result);
        data.document_id = result.document_id;
        data.detected = true;

        // Store state
        tabDocState.set(tabId, data);

        // Notify sidepanel
        chrome.runtime.sendMessage({
          type: 'DOCUMENT_READY',
          data: data,
        }).catch(() => {
          // Sidepanel might not be open yet — that's OK, it will poll on open
        });
      })
      .catch(err => {
        console.error('[DocuMind BG] Text upload failed:', err);
        data.upload_error = err.toString();
        
        // Notify sidepanel immediately of error
        chrome.runtime.sendMessage({
          type: 'DOCUMENT_READY',
          data: data,
        }).catch(() => {});
      });
    });

    sendResponse({ status: 'processing' });
  }

  // --- Sidepanel polls for current tab state ---
  if (message.type === 'GET_TAB_DOC_STATE') {
    const state = tabDocState.get(message.tabId) || null;
    sendResponse({ state });
  }

  // --- Legacy: raw byte upload (still useful for direct HTTP PDFs) ---
  if (message.type === 'UPLOAD_DOCUMENT') {
    chrome.storage.local.get(['supabaseToken'], (result) => {
      const token = result.supabaseToken;
      if (!token) {
        sendResponse({ error: 'Not authenticated. Please log in to the DocuMind Web App.' });
        return;
      }

      fetch('http://127.0.0.1:8000/api/documents/upload', {
        method: 'POST',
        body: (() => {
          const formData = new FormData();
          const blob = new Blob([new Uint8Array(message.bytes)], { type: message.contentType });
          formData.append('file', blob, message.filename);
          return formData;
        })(),
        headers: {
          'Authorization': `Bearer ${token}`,
        },
      })
      .then(r => r.json())
      .then(data => sendResponse({ document_id: data.id, error: data.detail }))
      .catch(err => sendResponse({ error: err.toString() }));
    });

    return true; // Keep channel open for async response
  }

  // --- Smart Annotations (F-06) ---
  if (message.type === 'ANNOTATE_TEXT') {
    chrome.storage.local.get(['supabaseToken'], (result) => {
      const token = result.supabaseToken;
      if (!token) {
        sendResponse({ success: false, error: 'Not authenticated. Please log in to the DocuMind Web App.' });
        return;
      }

      fetch('http://127.0.0.1:8000/api/annotations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`,
        },
        body: JSON.stringify({
          text: message.data.text,
          action: message.data.action,
          language: message.data.language,
        }),
      })
      .then(async r => {
        const result = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(result.detail || 'Annotation failed');
        return result;
      })
      .then(data => sendResponse({ success: true, result: data.result }))
      .catch(err => sendResponse({ success: false, error: err.toString() }));
    });
    return true; // async
  }

  return true; // async
});

// ─── Keyboard shortcut: Alt+D ───────────────────────────────────────────────
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-sidebar') {
    // MUST call open() synchronously in the event handler to preserve the user gesture
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs.length > 0 && tabs[0].windowId) {
        chrome.sidePanel.open({ windowId: tabs[0].windowId }).catch(console.error);
      }
    });
  }
});

console.log('[DocuMind] 🚀 Background service worker initialized.');
