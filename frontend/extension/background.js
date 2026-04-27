/**
 * DocuMind AI — Background Service Worker (Manifest V3)
 * Handles document auto-detection and sidebar toggling.
 */

// Supported document MIME types and file extensions
const SUPPORTED_EXTENSIONS = new Set([
  '.pdf', '.docx', '.doc', '.pptx', '.ppt', '.xlsx', '.xls',
  '.txt', '.md', '.csv', '.json', '.yaml',
  '.epub', '.odt', '.odp', '.ods', '.wps',
]);

const SUPPORTED_MIME_PATTERNS = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats',
  'text/plain',
  'text/markdown',
  'text/csv',
];

/**
 * Check if a URL points to a supported document.
 */
function isDocumentUrl(url) {
  try {
    const pathname = new URL(url).pathname.toLowerCase();
    return [...SUPPORTED_EXTENSIONS].some(ext => pathname.endsWith(ext));
  } catch {
    return false;
  }
}

// --- Toggle sidebar via action click ---
chrome.action.onClicked.addListener(async (tab) => {
  if (tab.id) {
    await chrome.sidePanel.open({ tabId: tab.id });
  }
});

// --- Keyboard shortcut handler ---
chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-sidebar') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  }
});

// --- Auto-detect documents on tab update ---
chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url) {
    if (isDocumentUrl(tab.url)) {
      // Enable the side panel and notify the user
      await chrome.sidePanel.setOptions({
        tabId,
        path: 'sidepanel.html',
        enabled: true,
      });
      console.log(`[DocuMind] Document detected: ${tab.url}`);
    }
  }
});

// --- Listen for messages from content script ---
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'DOCUMENT_DETECTED') {
    console.log(`[DocuMind] Content script detected document:`, message.data);
    if (sender.tab?.id) {
      chrome.sidePanel.open({ tabId: sender.tab.id });
    }
    sendResponse({ status: 'ok' });
  }
  return true; // async response
});
