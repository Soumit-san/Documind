/**
 * DocuMind AI — Side Panel Logic (F-01 + F-02)
 * Handles: tab switching, document state, auto-summarize, chat, status updates.
 */

(() => {
  'use strict';

  const API_BASE = 'http://127.0.0.1:8000/api';

  // ─── DOM References ─────────────────────────────────────────
  const tabs = document.querySelectorAll('.dm-tab');
  const panels = document.querySelectorAll('.dm-panel');
  const statusBar = document.getElementById('doc-status');
  const statusIcon = statusBar?.querySelector('.dm-status__icon');
  const statusText = statusBar?.querySelector('.dm-status__text');
  const badgeAnalyzed = document.getElementById('badge-analyzed');
  const summaryTakeaways = document.getElementById('summary-takeaways');
  const summarySkeleton = document.getElementById('summary-skeleton');
  const sectionBreakdownContainer = document.getElementById('section-breakdown-container');
  const sectionBreakdown = document.getElementById('section-breakdown');
  const docContext = document.getElementById('doc-context');
  const docUrlDisplay = document.getElementById('doc-url-display');
  const analysisProgress = document.getElementById('analysis-progress');
  const analysisLabel = document.getElementById('analysis-label');
  const btnAnalyze = document.getElementById('btn-analyze');
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatMessages = document.getElementById('chat-messages');

  const entitiesContainer = document.getElementById('entities-container');
  const entitiesList = document.getElementById('entities-list');
  const entitiesPeople = document.getElementById('entities-people');
  const entitiesDates = document.getElementById('entities-dates');
  const entitiesTerms = document.getElementById('entities-terms');
  const badgeEntities = document.getElementById('badge-entities');

  // ─── State ──────────────────────────────────────────────────
  let currentDocId = null;
  let chatHistory = [];
  let currentDocData = null;

  // ─── Tab Switching ──────────────────────────────────────────
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => {
        t.classList.remove('dm-tab--active');
        t.setAttribute('aria-selected', 'false');
      });
      panels.forEach(p => (p.hidden = true));

      tab.classList.add('dm-tab--active');
      tab.setAttribute('aria-selected', 'true');
      const panelId = `panel-${tab.dataset.tab}`;
      const panel = document.getElementById(panelId);
      if (panel) panel.hidden = false;

      // If switching to chat, focus the input
      if (tab.dataset.tab === 'chat') {
        chatInput?.focus();
      }
    });
  });

  // ─── Status Updates ─────────────────────────────────────────
  function setStatus(state, text, icon) {
    if (!statusBar) return;
    statusBar.className = `dm-status dm-status--${state}`;
    if (statusIcon) statusIcon.textContent = icon || 'search';
    if (statusText) statusText.textContent = text;
  }

  function setProgress(percent, label) {
    if (analysisProgress) analysisProgress.style.width = `${percent}%`;
    if (analysisLabel) analysisLabel.textContent = label || `Analysis: ${percent}%`;
  }

  function showDocContext(url) {
    if (!docContext) return;
    docContext.style.display = 'block';
    if (docUrlDisplay) {
      try {
        const parsed = new URL(url);
        docUrlDisplay.textContent = parsed.hostname + parsed.pathname.slice(0, 30);
      } catch {
        docUrlDisplay.textContent = url.slice(0, 40);
      }
    }
  }

  // ─── Rendering ─────────────────────────────────────
  function renderTakeaways(summaryData) {
    if (!summaryTakeaways) return;
    summaryTakeaways.innerHTML = '';
    summaryTakeaways.style.display = 'flex';
    if (summarySkeleton) summarySkeleton.style.display = 'none';

    // summaryData might be a dict containing "summary" and "citations"
    const text = summaryData.summary || String(summaryData);
    
    // Split into sentences for the numbered list effect
    const sentences = text.match(/[^\.!\?]+[\.!\?]+/g) || [text];
    
    sentences.forEach((sentence, i) => {
      if (!sentence.trim()) return;
      const card = document.createElement('div');
      card.className = 'dm-takeaway';
      card.innerHTML = `
        <span class="dm-takeaway__number">${String(i + 1).padStart(2, '0')}</span>
        <p class="dm-takeaway__text">${sentence.trim()}</p>
      `;
      summaryTakeaways.appendChild(card);
    });

    if (badgeAnalyzed) badgeAnalyzed.style.display = 'inline-block';
  }

  function renderSections(sectionData) {
    if (!sectionBreakdownContainer || !sectionBreakdown) return;
    sectionBreakdownContainer.style.display = 'block';
    sectionBreakdown.innerHTML = '';

    const sections = sectionData.sections || [];
    sections.forEach(sec => {
      const el = document.createElement('div');
      el.className = 'dm-accordion';
      el.innerHTML = `
        <button class="dm-accordion__header">
          ${sec.title}
          <span class="material-symbols-outlined">expand_more</span>
        </button>
        <div class="dm-accordion__content">
          <p>${sec.summary}</p>
          ${sec.page ? `<span class="dm-entity-chip">(Page ${sec.page})</span>` : ''}
        </div>
      `;
      // Toggle logic
      const btn = el.querySelector('.dm-accordion__header');
      btn.addEventListener('click', () => el.classList.toggle('dm-accordion--open'));
      sectionBreakdown.appendChild(el);
    });
  }

  function renderEntities(entityData) {
    if (!entitiesContainer || !entitiesList) return;
    entitiesList.style.display = 'none';
    entitiesContainer.style.display = 'flex';
    if (badgeEntities) badgeEntities.style.display = 'inline-block';

    const renderChips = (container, items) => {
      if (!container) return;
      container.innerHTML = (items || []).map(i => `<span class="dm-entity-chip">${i}</span>`).join('');
      if (!items || items.length === 0) container.innerHTML = '<span style="color:var(--text-tertiary);">None found</span>';
    };

    const e = entityData.entities || {};
    renderChips(entitiesPeople, [...(e.people || []), ...(e.organizations || [])]);
    renderChips(entitiesDates, [...(e.dates || []), ...(e.amounts || [])]);
    renderChips(entitiesTerms, e.terms || []);
  }

  // ─── Auto-Summarize Pipeline ─────────────────────────────────
  async function triggerAutoSummarize(docId) {
    if (!docId) return;
    
    if (btnAnalyze) btnAnalyze.style.display = 'none';
    if (summaryTakeaways) summaryTakeaways.style.display = 'none';
    if (summarySkeleton) summarySkeleton.style.display = 'flex';
    
    setStatus('detecting', 'Analyzing document...', 'psychology');
    setProgress(50, 'Analysis: Generating insights...');

    try {
      const response = await fetch(`${API_BASE}/summarize/auto`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ document_id: docId })
      });

      if (!response.ok) {
        throw new Error(`Server returned ${response.status}`);
      }

      const data = await response.json();
      const results = data.results;

      setProgress(100, 'Analysis: Complete');
      setStatus('ready', 'Document analyzed completely', 'check_circle');

      if (results.executive) renderTakeaways(results.executive);
      if (results.sections) renderSections(results.sections);
      if (results.entities) renderEntities(results.entities);

    } catch (err) {
      console.error('[DocuMind] Auto-summarize failed:', err);
      if (summarySkeleton) summarySkeleton.style.display = 'none';
      if (summaryTakeaways) {
        summaryTakeaways.style.display = 'block';
        summaryTakeaways.innerHTML = `
          <div class="dm-error-card">
            <span class="material-symbols-outlined">error</span>
            <div>
              <p style="font-weight:700;">Analysis Failed</p>
              <p style="font-size:12px;">Could not connect to DocuMind AI backend or LLM.</p>
            </div>
          </div>
        `;
      }
      setProgress(0, 'Analysis: Failed');
      setStatus('idle', 'Failed to analyze document', 'error');
      if (btnAnalyze) btnAnalyze.style.display = 'block';
    }
  }

  if (btnAnalyze) {
    btnAnalyze.addEventListener('click', () => {
      triggerAutoSummarize(currentDocId);
    });
  }

  // ─── Document Detection Handler ─────────────────────────────
  async function handleDocumentDetected(data) {
    currentDocData = data;
    console.log('[DocuMind SidePanel] Document detected:', data);

    showDocContext(data.url);

    if (data.document_id) {
      // Backend already has it indexed — go straight to summarize
      currentDocId = data.document_id;
      triggerAutoSummarize(currentDocId);
      return;
    }

    if (data.upload_error) {
      // Background script failed to upload text
      setStatus('idle', 'Text extraction failed', 'error');
      setProgress(0, 'Upload failed');
      if (summaryTakeaways) {
        summaryTakeaways.style.display = 'block';
        summaryTakeaways.innerHTML = `
          <div class="dm-error-card">
            <span class="material-symbols-outlined">error</span>
            <div>
              <p style="font-weight:700;">Text Extraction Failed</p>
              <p style="font-size:12px;">Could not extract readable text from this page. Try uploading the file directly via the <a href="http://localhost:3000/dashboard" target="_blank" style="color:inherit;font-weight:700;">DocuMind Web App</a>.</p>
            </div>
          </div>
        `;
      }
      if (btnAnalyze) btnAnalyze.style.display = 'none';
      return;
    }

    // Text is being extracted and uploaded by the background script — show processing state
    setStatus('detecting', 'Extracting text from document…', 'psychology');
    setProgress(30, 'Analysis: Reading document…');

    // Safety timeout: if no document_id arrives in 60s, show error with retry
    const uploadTimeout = setTimeout(() => {
      if (!currentDocId) {
        setStatus('idle', 'Processing timed out', 'error');
        setProgress(0, 'Timed out');
        if (summaryTakeaways) {
          summaryTakeaways.style.display = 'block';
          summaryTakeaways.innerHTML = `
            <div class="dm-error-card">
              <span class="material-symbols-outlined">error</span>
              <div>
                <p style="font-weight:700;">Processing Timed Out</p>
                <p style="font-size:12px;">Make sure the backend is running at 127.0.0.1:8000. You can also try uploading directly via the <a href="http://localhost:3000/dashboard" target="_blank" style="color:inherit;font-weight:700;">Web App</a>.</p>
              </div>
            </div>
          `;
        }
      }
    }, 60000);

    currentDocData._uploadTimeout = uploadTimeout;
  }

  // ─── Chat ───────────────────────────────────────────────────
  function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = `dm-message dm-message--${role}`;

    if (role === 'assistant') {
      div.innerHTML = `
        <div class="dm-message__avatar">
          <span class="material-symbols-outlined">psychology</span>
        </div>
        <div class="dm-message__content"><p>${content}</p></div>
      `;
    } else {
      div.innerHTML = `<div class="dm-message__content"><p>${content}</p></div>`;
    }

    chatMessages?.appendChild(div);
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  chatForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = chatInput?.value?.trim();
    if (!question) return;

    addMessage('user', question);
    chatInput.value = '';

    // Typing indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'dm-message dm-message--assistant';
    typingDiv.innerHTML = `
      <div class="dm-message__avatar">
        <span class="material-symbols-outlined">psychology</span>
      </div>
      <div class="dm-message__content"><p>Thinking<span class="dm-loading-dots"></span></p></div>
    `;
    chatMessages?.appendChild(typingDiv);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    try {
      if (!currentDocId) {
        throw new Error("No document has been uploaded or analyzed yet.");
      }

      const response = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: currentDocId,
          question,
          history: chatHistory,
        }),
      });

      const data = await response.json();
      chatMessages?.removeChild(typingDiv);

      addMessage('assistant', data.answer || 'Sorry, I could not generate an answer.');

      // Citation chips
      if (data.citations?.length) {
        const citDiv = document.createElement('div');
        citDiv.style.padding = '0 12px 8px 40px';
        citDiv.innerHTML = data.citations
          .map(c => `<span class="dm-entity-chip">${c.section || (c.page ? 'Page ' + c.page : 'Source')}</span>`)
          .join(' ');
        chatMessages?.appendChild(citDiv);
      }

      chatHistory.push({ role: 'user', content: question });
      chatHistory.push({ role: 'assistant', content: data.answer });
    } catch (err) {
      chatMessages?.removeChild(typingDiv);
      addMessage('assistant', 'Error connecting to DocuMind AI backend: ' + err.message);
      console.error('[DocuMind] Chat error:', err);
    }
  });

  // ─── Copy Summary Button ────────────────────────────────────
  document.getElementById('btn-copy-summary')?.addEventListener('click', () => {
    const takeaways = document.querySelectorAll('.dm-takeaway__text');
    if (takeaways.length === 0) return;
    const text = Array.from(takeaways).map((t, i) => `${i + 1}. ${t.textContent}`).join('\n');
    navigator.clipboard.writeText(text).then(() => {
      const btn = document.getElementById('btn-copy-summary');
      const original = btn?.innerHTML;
      if (btn) {
        btn.innerHTML = '<span class="material-symbols-outlined">check</span>Copied!';
        setTimeout(() => { btn.innerHTML = original; }, 2000);
      }
    });
  });

  // ─── Listen for messages from background ────────────────────
  chrome.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
    if (message.type === 'DOCUMENT_READY') {
      handleDocumentDetected(message.data);
      sendResponse({ status: 'ok' });
    }
    return true;
  });

  // ─── On load: check if the current tab already has a doc ────
  async function checkCurrentTab() {
    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id) {
        const response = await chrome.runtime.sendMessage({
          type: 'GET_TAB_DOC_STATE',
          tabId: tab.id,
        });
        if (response?.state?.detected) {
          handleDocumentDetected(response.state);
        }
      }
    } catch (e) {
      console.log('[DocuMind] Could not check current tab:', e);
    }
  }

  checkCurrentTab();
})();
