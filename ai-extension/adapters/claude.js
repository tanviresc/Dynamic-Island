// Site-specific rules and selectors for Claude (claude.ai)
(function (global) {
  'use strict';

  global.ClaudeAdapterConfig = {
    site: 'claude',
    debug: true, // debugAdapters flag
    debounceMs: 300, // Reduced from 1000ms to 300ms for snappy notifications

    // Layer 1: URL pattern matching for Claude generation streams only
    urlPatterns: [
      /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/completion/i,
      /\/api\/organizations\/[^/]+\/chat_conversations\/[^/]+\/append_message/i,
      /\/api\/organizations\/[^/]+\/retry_completion/i,
      /\/append_message/i,
      /\/completion/i
    ],

    // Function to check if a fetch/XHR request matches Claude completions
    isStreamRequest(url, method) {
      if (!url) return false;
      const isPost = !method || method.toUpperCase() === 'POST';
      if (!isPost) return false;

      return this.urlPatterns.some((pattern) => pattern.test(url));
    },

    // Function to clean document.title for notification text
    cleanTitle(title) {
      if (!title) return 'Claude Chat';
      return title
        .replace(/\s*\|\s*Claude\s*$/i, '')
        .replace(/\s*-\s*Claude\s*$/i, '')
        .replace(/^Claude\s*\|\s*/i, '')
        .trim() || 'Claude Chat';
    },

    // Layer 2: DOM Selectors for Permission / Interactive Prompts ("needs_input")
    dom: {
      containerSelector: 'main, [data-testid="chat-container"], div.flex-1, body',
      promptSelectors: [
        '[role="dialog"]',
        '[role="alertdialog"]',
        'div[class*="permission"]',
        'div[class*="confirmation"]',
        'div[class*="modal"]'
      ],
      interactiveButtonTexts: [
        'allow',
        'always allow',
        'approve',
        'confirm',
        'deny',
        'reject',
        'cancel',
        'proceed',
        'run'
      ]
    }
  };
})(window);
