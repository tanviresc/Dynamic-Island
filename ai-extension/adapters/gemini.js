// Site-specific rules and selectors for Google Gemini (gemini.google.com)
(function (global) {
  'use strict';

  global.GeminiAdapterConfig = {
    site: 'gemini',
    debug: true, // debugAdapters flag
    debounceMs: 300,

    // Layer 1: Strict URL pattern matching for Gemini generation streams
    urlPatterns: [
      /StreamGenerate/i,
      /batchexecute.*[?&]rt=c\b/i
    ],

    // Function to check if a fetch/XHR request matches Gemini generation
    isStreamRequest(url, method, body) {
      if (!url) return false;
      const isPost = !method || method.toUpperCase() === 'POST';
      if (!isPost) return false;

      // 1. Direct match for StreamGenerate in URL or body
      if (/StreamGenerate/i.test(url)) return true;
      if (typeof body === 'string' && /StreamGenerate/i.test(body)) return true;

      // 2. Google batchexecute streaming RPC:
      // Must contain 'rt=c' (response-type: chunked stream). Page load uses 'rt=b' or no rt param!
      if (/batchexecute/i.test(url) && /[?&]rt=c\b/i.test(url)) {
        return true;
      }

      return false;
    },

    // Function to clean document.title for notification text
    cleanTitle(title) {
      if (!title) return 'Gemini';
      return title
        .replace(/\s*[-|]\s*Gemini\s*$/i, '')
        .replace(/\s*[-|]\s*Google Gemini\s*$/i, '')
        .replace(/^Gemini\s*[-|:]\s*/i, '')
        .trim() || 'Gemini';
    },

    // Layer 2: DOM Selectors for Permission / Interactive Prompts ("needs_input")
    dom: {
      containerSelector: 'main, body, [role="main"]',
      promptSelectors: [
        '[role="dialog"]',
        '[role="alertdialog"]',
        'mat-dialog-container',
        'div[class*="dialog"]',
        'div[class*="modal"]'
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
