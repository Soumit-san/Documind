/**
 * DocuMind AI — Side Panel Logic
 * Handles tab switching, chat interactions, and API communication.
 */

(() => {
  'use strict';

  const API_BASE = 'http://localhost:8000/api';

  // --- Tab Switching ---
  const tabs = document.querySelectorAll('.dm-tab');
  const panels = document.querySelectorAll('.dm-panel');

  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      // Deactivate all
      tabs.forEach(t => {
        t.classList.remove('dm-tab--active');
        t.setAttribute('aria-selected', 'false');
      });
      panels.forEach(p => p.hidden = true);

      // Activate clicked
      tab.classList.add('dm-tab--active');
      tab.setAttribute('aria-selected', 'true');
      const panelId = `panel-${tab.dataset.tab}`;
      const panel = document.getElementById(panelId);
      if (panel) {
        panel.hidden = false;
      }
    });
  });

  // --- Chat ---
  const chatForm = document.getElementById('chat-form');
  const chatInput = document.getElementById('chat-input');
  const chatMessages = document.getElementById('chat-messages');
  let chatHistory = [];
  let currentDocId = null;

  function addMessage(role, content) {
    const div = document.createElement('div');
    div.className = `dm-message dm-message--${role}`;
    div.innerHTML = `<p>${content}</p>`;
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  chatForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = chatInput.value.trim();
    if (!question) return;

    addMessage('user', question);
    chatInput.value = '';

    // Show typing indicator
    const typingDiv = document.createElement('div');
    typingDiv.className = 'dm-message dm-message--assistant';
    typingDiv.innerHTML = '<p>Thinking…</p>';
    chatMessages.appendChild(typingDiv);

    try {
      const response = await fetch(`${API_BASE}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          document_id: currentDocId || 'demo',
          question,
          history: chatHistory,
        }),
      });

      const data = await response.json();
      chatMessages.removeChild(typingDiv);

      addMessage('assistant', data.answer || 'Sorry, I could not generate an answer.');

      // Add citations as chips
      if (data.citations?.length) {
        const citationsHtml = data.citations
          .map(c => `<span class="dm-chip">${c.section || c.text}</span>`)
          .join(' ');
        const citDiv = document.createElement('div');
        citDiv.style.padding = '0 24px 12px';
        citDiv.innerHTML = citationsHtml;
        chatMessages.appendChild(citDiv);
      }

      // Update history
      chatHistory.push({ role: 'user', content: question });
      chatHistory.push({ role: 'assistant', content: data.answer });

    } catch (err) {
      chatMessages.removeChild(typingDiv);
      addMessage('assistant', 'Error connecting to DocuMind AI backend. Is it running?');
      console.error('[DocuMind] Chat error:', err);
    }
  });

  // --- Listen for document detection events ---
  chrome.runtime?.onMessage?.addListener((message, sender, sendResponse) => {
    if (message.type === 'DOCUMENT_READY') {
      currentDocId = message.docId;
      // Could trigger auto-summarization here
    }
  });
})();
