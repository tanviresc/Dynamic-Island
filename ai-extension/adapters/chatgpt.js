// Site-specific rules and selectors for ChatGPT (chatgpt.com & chat.openai.com)
(function (global) {
  'use strict';

  global.ChatGPTAdapterConfig = {
    site: 'chatgpt',
    debug: true, // debugAdapters flag
    debounceMs: 300,

    // Layer 1: Strict URL pattern matching for ChatGPT generation streams
    // Must match ONLY the SSE generation endpoint, never telemetry (/lat/r) or sidebar lists (/conversations)
    urlPatterns: [
      /\/backend-api\/conversation(?:\?|$)/i,
      /\/backend-anon\/conversation(?:\?|$)/i
    ],

    // Function to check if a fetch/XHR request matches ChatGPT generation endpoints
    isStreamRequest(url, method) {
      if (!url) return false;
      const isPost = !method || method.toUpperCase() === 'POST';
      if (!isPost) return false;

      // Exclude plural /conversations or /lat telemetry
      if (url.includes('/conversations') || url.includes('/lat/')) {
        return false;
      }

      return this.urlPatterns.some((pattern) => pattern.test(url));
    },

    // Function to clean document.title for notification text
    cleanTitle(title) {
      if (!title) return 'ChatGPT';
      return title
        .replace(/\s*\|\s*ChatGPT\s*$/i, '')
        .replace(/\s*-\s*ChatGPT\s*$/i, '')
        .replace(/^ChatGPT\s*[-|:]\s*/i, '')
        .trim() || 'ChatGPT';
    },

    // Layer 2: DOM Selectors for Permission / Interactive Prompts ("needs_input")
    dom: {
      containerSelector: 'main, [role="presentation"], div[class*="react-scroll-to-bottom"], body',
      promptSelectors: [
        '[role="dialog"]',
        '[role="alertdialog"]',
        'div[class*="modal"]',
        'div[class*="confirmation"]',
        'div[class*="popover"]'
      ],
      interactiveButtonTexts: [
        'allow',
        'always allow',
        'approve',
        'confirm',
        'continue',
        'deny',
        'reject',
        'cancel',
        'proceed',
        'run'
      ]
    }
  };
})(window);
