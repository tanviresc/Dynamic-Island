// AI Island - Isolated Content Script for Google Gemini (gemini.google.com)
// Listens for postMessage from MAIN world (inject-gemini.js) and forwards to background service worker
(function () {
  'use strict';

  try {
    console.log('[ai-island:gemini] Content script (ISOLATED world) loaded and listening');

    window.addEventListener('message', (event) => {
      // Only accept messages from current origin
      if (event.origin !== window.location.origin) return;

      const data = event.data;
      if (!data || data.source !== 'ai-island-gemini') return;

      // Guard against extension context reload invalidation
      if (!chrome.runtime || !chrome.runtime.id) {
        console.warn('[ai-island:gemini] Extension context was reloaded. Please refresh this tab (Ctrl+F5).');
        return;
      }

      console.log(`[ai-island:gemini] Relaying "${data.type}" event to background service worker`);

      try {
        chrome.runtime.sendMessage({
          kind: 'site_event',
          type: data.type,
          site: 'gemini',
          taskKind: data.taskKind || 'question',
          message: data.message
        }).then((res) => {
          console.log(`[ai-island:gemini] Background service worker response:`, res);
        }).catch((err) => {
          if (err.message && err.message.includes('Extension context invalidated')) {
            console.warn('[ai-island:gemini] Extension reloaded. Please refresh this tab (Ctrl+F5).');
          } else {
            console.warn(`[ai-island:gemini] Failed to send to service worker:`, err);
          }
        });
      } catch (err) {
        console.warn('[ai-island:gemini] Extension reloaded. Please refresh this tab (Ctrl+F5).');
      }
    });
  } catch (err) {
    console.error('[ai-island:gemini] Content script error (isolated):', err);
  }
})();

