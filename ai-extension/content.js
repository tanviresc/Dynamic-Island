// AI Island - Isolated Content Script for Claude (claude.ai)
// Listens for postMessage from MAIN world (inject.js) and forwards to background service worker
(function () {
  'use strict';

  console.log('[ai-island:claude] Content script (ISOLATED world) loaded and listening');

  window.addEventListener('message', (event) => {
    // Only accept messages from current origin
    if (event.origin !== window.location.origin) return;

    const data = event.data;
    if (!data || data.source !== 'ai-island-claude') return;

    // Check if extension context is still active (guard against reload desync)
    if (!chrome.runtime || !chrome.runtime.id) {
      console.warn('[ai-island:claude] Extension context was reloaded. Please refresh this tab (Ctrl+F5) to reattach.');
      return;
    }

    console.log(`[ai-island:claude] Relaying "${data.type}" event to background service worker`);

    try {
      chrome.runtime.sendMessage({
        kind: 'site_event',
        type: data.type,
        site: 'claude',
        taskKind: data.taskKind || 'question',
        message: data.message
      }).then((res) => {
        console.log(`[ai-island:claude] Background service worker response:`, res);
      }).catch((err) => {
        if (err.message && err.message.includes('Extension context invalidated')) {
          console.warn('[ai-island:claude] Extension reloaded. Please refresh this tab (Ctrl+F5).');
        } else {
          console.warn(`[ai-island:claude] Failed to send to service worker:`, err);
        }
      });
    } catch (err) {
      console.warn('[ai-island:claude] Extension reloaded. Please refresh this tab (Ctrl+F5).');
    }
  });
})();
