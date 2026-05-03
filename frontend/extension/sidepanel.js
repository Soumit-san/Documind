/**
 * DocuMind AI — Side Panel Logic (F-01 + F-02 + F-03)
 * Handles: tab switching, document state, auto-summarize, chat Q&A, status updates.
 */

(() => {
  'use strict';

  let API_BASE = 'http://127.0.0.1:8000/api';
  let APP_URL = 'http://localhost:3000';

  chrome.storage.local.get(['apiBaseUrl', 'appUrl'], (result) => {
    if (result.apiBaseUrl) API_BASE = result.apiBaseUrl;
    if (result.appUrl) APP_URL = result.appUrl;
  });

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
  const chatWelcome = document.getElementById('chat-welcome');
  const chatStarters = document.getElementById('chat-starters');
  const chatSuggestions = document.getElementById('chat-suggestions');

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
  function switchToTab(tabName) {
    tabs.forEach(t => {
      t.classList.remove('dm-tab--active');
      t.setAttribute('aria-selected', 'false');
    });
    panels.forEach(p => (p.hidden = true));

    const targetTab = document.querySelector(`.dm-tab[data-tab="${tabName}"]`);
    if (targetTab) {
      targetTab.classList.add('dm-tab--active');
      targetTab.setAttribute('aria-selected', 'true');
    }
    const panel = document.getElementById(`panel-${tabName}`);
    if (panel) panel.hidden = false;

    if (tabName === 'chat') {
      chatInput?.focus();
    }
  }

  tabs.forEach(tab => {
    tab.addEventListener('click', () => switchToTab(tab.dataset.tab));
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

  // ─── Summary Rendering ─────────────────────────────────────
  function renderTakeaways(summaryData) {
    if (!summaryTakeaways) return;
    summaryTakeaways.innerHTML = '';
    summaryTakeaways.style.display = 'flex';
    if (summarySkeleton) summarySkeleton.style.display = 'none';

    const text = summaryData.summary || String(summaryData);
    const sentences = text.match(/[^\.!\?]+[\.!\?]+/g) || [text];
    
    sentences.forEach((sentence, i) => {
      if (!sentence.trim()) return;
      const card = document.createElement('div');
      card.className = 'dm-takeaway';

      const numSpan = document.createElement('span');
      numSpan.className = 'dm-takeaway__number';
      numSpan.textContent = String(i + 1).padStart(2, '0');

      const textP = document.createElement('p');
      textP.className = 'dm-takeaway__text';
      textP.textContent = sentence.trim();

      card.appendChild(numSpan);
      card.appendChild(textP);
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
      
      const btn = document.createElement('button');
      btn.className = 'dm-accordion__header';
      btn.textContent = sec.title;
      const iconSpan = document.createElement('span');
      iconSpan.className = 'material-symbols-outlined';
      iconSpan.textContent = 'expand_more';
      btn.appendChild(iconSpan);
      
      const content = document.createElement('div');
      content.className = 'dm-accordion__content';
      const p = document.createElement('p');
      p.textContent = sec.summary;
      content.appendChild(p);
      
      if (sec.page) {
        const pageSpan = document.createElement('span');
        pageSpan.className = 'dm-entity-chip';
        pageSpan.textContent = `(Page ${sec.page})`;
        content.appendChild(pageSpan);
      }
      
      el.appendChild(btn);
      el.appendChild(content);

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
      container.innerHTML = '';
      if (!items || items.length === 0) {
        const span = document.createElement('span');
        span.style.color = 'var(--text-tertiary)';
        span.textContent = 'None found';
        container.appendChild(span);
        return;
      }
      items.forEach(i => {
        const chip = document.createElement('span');
        chip.className = 'dm-entity-chip';
        chip.textContent = i;
        container.appendChild(chip);
      });
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
        summaryTakeaways.innerHTML = '';
        const errCard = document.createElement('div');
        errCard.className = 'dm-error-card';
        errCard.innerHTML = `
          <span class="material-symbols-outlined">error</span>
          <div>
            <p style="font-weight:700;">Analysis Failed</p>
            <p style="font-size:12px;">Could not connect to DocuMind AI backend or LLM.</p>
          </div>
        `;
        summaryTakeaways.appendChild(errCard);
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
      currentDocId = data.document_id;
      triggerAutoSummarize(currentDocId);
      return;
    }

    if (data.upload_error) {
      setStatus('idle', 'Text extraction failed', 'error');
      setProgress(0, 'Upload failed');
      if (summaryTakeaways) {
        summaryTakeaways.style.display = 'block';
        summaryTakeaways.innerHTML = '';
        const errCard = document.createElement('div');
        errCard.className = 'dm-error-card';
        errCard.innerHTML = `
          <span class="material-symbols-outlined">error</span>
          <div>
            <p style="font-weight:700;">Text Extraction Failed</p>
            <p style="font-size:12px;">Could not extract readable text from this page. Try uploading the file directly via the <a href="${APP_URL}/dashboard" target="_blank" style="color:inherit;font-weight:700;">DocuMind Web App</a>.</p>
          </div>
        `;
        summaryTakeaways.appendChild(errCard);
      }
      if (btnAnalyze) btnAnalyze.style.display = 'none';
      return;
    }

    setStatus('detecting', 'Extracting text from document…', 'psychology');
    setProgress(30, 'Analysis: Reading document…');

    const uploadTimeout = setTimeout(() => {
      if (!currentDocId) {
        setStatus('idle', 'Processing timed out', 'error');
        setProgress(0, 'Timed out');
        if (summaryTakeaways) {
          summaryTakeaways.style.display = 'block';
          summaryTakeaways.innerHTML = '';
          const errCard = document.createElement('div');
          errCard.className = 'dm-error-card';
          errCard.innerHTML = `
            <span class="material-symbols-outlined">error</span>
            <div>
              <p style="font-weight:700;">Processing Timed Out</p>
              <p style="font-size:12px;">Make sure the backend is running at 127.0.0.1:8000. You can also try uploading directly via the <a href="${APP_URL}/dashboard" target="_blank" style="color:inherit;font-weight:700;">Web App</a>.</p>
            </div>
          `;
          summaryTakeaways.appendChild(errCard);
        }
      }
    }, 60000);

    currentDocData._uploadTimeout = uploadTimeout;
  }

  // ─── Chat: Message Rendering ────────────────────────────────
  function hideWelcome() {
    if (chatWelcome) chatWelcome.style.display = 'none';
  }

  function addMessage(role, content, citations, followUps) {
    hideWelcome();

    const msgDiv = document.createElement('div');
    msgDiv.className = `dm-message dm-message--${role}`;

    if (role === 'assistant') {
      // Avatar
      const avatar = document.createElement('div');
      avatar.className = 'dm-message__avatar';
      const avatarIcon = document.createElement('span');
      avatarIcon.className = 'material-symbols-outlined';
      avatarIcon.textContent = 'psychology';
      avatar.appendChild(avatarIcon);
      msgDiv.appendChild(avatar);
    }

    // Content wrapper
    const contentDiv = document.createElement('div');
    contentDiv.className = 'dm-message__content';

    // Message text
    const p = document.createElement('p');
    p.textContent = content;
    contentDiv.appendChild(p);

    // Citation chips (assistant only)
    if (role === 'assistant' && citations && citations.length > 0) {
      const citRow = document.createElement('div');
      citRow.className = 'dm-message__citations';
      citations.forEach(c => {
        const chip = document.createElement('span');
        chip.className = 'dm-entity-chip dm-entity-chip--date';
        chip.textContent = c.page ? `Page ${c.page}` : (c.section || 'Source');
        citRow.appendChild(chip);
      });
      contentDiv.appendChild(citRow);
    }

    // Action buttons (assistant only)
    if (role === 'assistant') {
      const actionsDiv = document.createElement('div');
      actionsDiv.className = 'dm-message__actions';

      // Copy button
      const copyBtn = document.createElement('button');
      copyBtn.className = 'dm-msg-action-btn';
      copyBtn.title = 'Copy answer';
      copyBtn.innerHTML = '<span class="material-symbols-outlined">content_copy</span>';
      copyBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(content).then(() => {
          copyBtn.innerHTML = '<span class="material-symbols-outlined">check</span>';
          setTimeout(() => {
            copyBtn.innerHTML = '<span class="material-symbols-outlined">content_copy</span>';
          }, 1500);
        });
      });

      // Thumbs up
      const thumbsUp = document.createElement('button');
      thumbsUp.className = 'dm-msg-action-btn';
      thumbsUp.title = 'Good answer';
      thumbsUp.innerHTML = '<span class="material-symbols-outlined">thumb_up</span>';
      thumbsUp.addEventListener('click', () => {
        thumbsUp.classList.toggle('dm-msg-action-btn--active');
        thumbsDown.classList.remove('dm-msg-action-btn--active');
      });

      // Thumbs down
      const thumbsDown = document.createElement('button');
      thumbsDown.className = 'dm-msg-action-btn';
      thumbsDown.title = 'Bad answer';
      thumbsDown.innerHTML = '<span class="material-symbols-outlined">thumb_down</span>';
      thumbsDown.addEventListener('click', () => {
        thumbsDown.classList.toggle('dm-msg-action-btn--active');
        thumbsUp.classList.remove('dm-msg-action-btn--active');
      });

      actionsDiv.appendChild(copyBtn);
      actionsDiv.appendChild(thumbsUp);
      actionsDiv.appendChild(thumbsDown);
      contentDiv.appendChild(actionsDiv);
    }

    msgDiv.appendChild(contentDiv);
    chatMessages?.appendChild(msgDiv);

    // Scroll to bottom
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;

    // Render follow-up suggestions
    if (role === 'assistant' && followUps && followUps.length > 0) {
      renderFollowUpSuggestions(followUps);
    }
  }

  // ─── Chat: Typing Indicator ─────────────────────────────────
  function showTypingIndicator() {
    hideWelcome();
    const typingDiv = document.createElement('div');
    typingDiv.className = 'dm-message dm-message--assistant';
    typingDiv.id = 'typing-indicator';

    const avatar = document.createElement('div');
    avatar.className = 'dm-message__avatar';
    avatar.innerHTML = '<span class="material-symbols-outlined">psychology</span>';

    const contentDiv = document.createElement('div');
    contentDiv.className = 'dm-message__content';
    contentDiv.innerHTML = `
      <div class="dm-typing-indicator">
        <span class="dm-typing-dot"></span>
        <span class="dm-typing-dot"></span>
        <span class="dm-typing-dot"></span>
      </div>
    `;

    typingDiv.appendChild(avatar);
    typingDiv.appendChild(contentDiv);
    chatMessages?.appendChild(typingDiv);
    if (chatMessages) chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  function removeTypingIndicator() {
    const indicator = document.getElementById('typing-indicator');
    if (indicator) indicator.remove();
  }

  // ─── Chat: Follow-up Suggestions ────────────────────────────
  function renderFollowUpSuggestions(questions) {
    if (!chatSuggestions) return;
    chatSuggestions.innerHTML = '';
    chatSuggestions.style.display = 'flex';

    questions.forEach(q => {
      const chip = document.createElement('button');
      chip.className = 'dm-follow-up dm-follow-up--compact';
      chip.textContent = q;
      chip.addEventListener('click', () => {
        chatInput.value = q;
        chatSuggestions.style.display = 'none';
        sendChatMessage(q);
      });
      chatSuggestions.appendChild(chip);
    });
  }

  function clearFollowUpSuggestions() {
    if (!chatSuggestions) return;
    chatSuggestions.innerHTML = '';
    chatSuggestions.style.display = 'none';
  }

  // ─── Chat: Send Message ─────────────────────────────────────
  async function sendChatMessage(question) {
    if (!question || !question.trim()) return;
    question = question.trim();

    // Switch to chat tab if not already there
    switchToTab('chat');

    // Clear input
    if (chatInput) chatInput.value = '';

    // Add user message
    addMessage('user', question);

    // Clear previous follow-up suggestions
    clearFollowUpSuggestions();

    // Show typing indicator
    showTypingIndicator();

    try {
      if (!currentDocId) {
        throw new Error("No document has been uploaded or analyzed yet. Open a document first.");
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

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.detail || `Server error: ${response.status}`);
      }

      const data = await response.json();
      removeTypingIndicator();

      const answer = data.answer || 'Sorry, I could not generate an answer.';
      addMessage(
        'assistant',
        answer,
        data.citations || [],
        data.follow_up_questions || []
      );

      // Update chat history
      chatHistory.push({ role: 'user', content: question });
      chatHistory.push({ role: 'assistant', content: answer });

    } catch (err) {
      removeTypingIndicator();
      addMessage('assistant', `⚠ ${err.message}`, [], []);
      console.error('[DocuMind] Chat error:', err);
    }
  }

  // ─── Chat: Form Submit ──────────────────────────────────────
  chatForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = chatInput?.value?.trim();
    if (!question) return;
    sendChatMessage(question);
  });

  // ─── Chat: Starter Questions ────────────────────────────────
  chatStarters?.querySelectorAll('.dm-follow-up')?.forEach(btn => {
    btn.addEventListener('click', () => {
      const question = btn.dataset.question;
      if (question) sendChatMessage(question);
    });
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
