// AI Island - Main World Injected Script for ChatGPT (chatgpt.com & chat.openai.com)
(function () {
  'use strict';

  try {
    if (window.__aiIslandChatGPTInjected) return;
    window.__aiIslandChatGPTInjected = true;

    const config = window.ChatGPTAdapterConfig || {
      site: 'chatgpt',
      debug: true,
      debounceMs: 300,
      isStreamRequest: () => false,
      cleanTitle: (t) => t,
      dom: {
        containerSelector: 'main, body',
        promptSelectors: ['[role="dialog"]'],
        interactiveButtonTexts: ['allow', 'continue', 'approve']
      }
    };

    const adapter = new window.AiIslandCore(config);
    adapter.log('Injected page script initialized in MAIN world (ChatGPT)');

    // ==========================================
    // Layer 1: Network & Stream Interception
    // ==========================================

    // Capture user clicking the Stop button in capture phase
    window.addEventListener('click', (e) => {
      try {
        const btn = e.target && e.target.closest ? e.target.closest('button, [role="button"]') : null;
        if (!btn) return;

        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
        const text = (btn.textContent || '').toLowerCase();

        if (
          testId.includes('stop') ||
          label.includes('stop') ||
          text.includes('stop')
        ) {
          adapter.markUserStopped();
        }
      } catch (err) {}
    }, true);

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      let url = '';
      let method = 'GET';
      let signal = null;

      try {
        if (typeof args[0] === 'string') {
          url = args[0];
        } else if (args[0] instanceof Request || (args[0] && args[0].url)) {
          url = args[0].url;
          method = args[0].method || 'GET';
          signal = args[0].signal || null;
        } else if (args[0] instanceof URL) {
          url = args[0].href;
        }

        if (args[1]) {
          if (args[1].method) method = args[1].method;
          if (args[1].signal) signal = args[1].signal;
        }
      } catch (e) {}

      const isGenerationEndpoint = config.isStreamRequest(url, method);

      let response;
      try {
        response = await originalFetch.apply(this, args);
      } catch (err) {
        if (isGenerationEndpoint) {
          if (adapter.userClickedStop) {
            adapter.onStreamAbort(url, 'aborted');
          } else {
            adapter.onStreamDone(url);
          }
        }
        throw err;
      }

      try {
        const contentType = (response.headers && response.headers.get('content-type')) || '';
        const status = response.status;
        const isEventStream = contentType.toLowerCase().includes('text/event-stream');

        if (isGenerationEndpoint || isEventStream) {
          adapter.log(`fetch: ${method} ${url} (status: ${status}, type: ${contentType})`);
        }

        if (status === 429) {
          if (isGenerationEndpoint || isEventStream) {
            adapter.onLimitReached(url, status);
          }
        } else if (status >= 400) {
          if (isGenerationEndpoint) {
            adapter.onStreamAbort(url, `HTTP ${status}`);
          }
        } else if (response.ok && (isEventStream || (isGenerationEndpoint && !contentType.toLowerCase().includes('application/json')))) {
          adapter.onStreamStart(url);
          adapter.watchStreamResponse(response, url, signal);
        }
      } catch (err) {
        adapter.log('Error inspecting fetch response:', err);
      }

      return response;
    };

    // 2. Monkey-patch XMLHttpRequest
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
      this.__ai_method = method;
      this.__ai_url = url;
      return originalXHROpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (...body) {
      const url = this.__ai_url || '';
      const method = this.__ai_method || 'GET';

      if (config.isStreamRequest(url, method)) {
        this.addEventListener('load', () => {
          const contentType = this.getResponseHeader('content-type') || '';
          const isEventStream = contentType.toLowerCase().includes('text/event-stream');

          adapter.log(`xhr load: ${method} ${url} (status: ${this.status}, type: ${contentType})`);
          if (this.status === 429) {
            adapter.onLimitReached(url, this.status);
          } else if (this.status >= 200 && this.status < 300) {
            if (isEventStream) {
              adapter.onStreamDone(url);
            }
          } else {
            adapter.onStreamAbort(url, `HTTP ${this.status}`);
          }
        });

        this.addEventListener('abort', () => {
          if (adapter.userClickedStop) {
            adapter.onStreamAbort(url, 'aborted');
          } else {
            adapter.onStreamDone(url);
          }
        });

        this.addEventListener('error', () => {
          adapter.onStreamAbort(url, 'error');
        });
      }

      return originalXHRSend.apply(this, body);
    };

    // ==========================================
    // Layer 2: Lightweight Throttled DOM Watching
    // ==========================================

    let domCheckTimeout = null;

    function scheduleDomCheck() {
      if (domCheckTimeout) return;
      domCheckTimeout = setTimeout(() => {
        domCheckTimeout = null;
        checkDomForPrompts();
      }, 200);
    }

    function checkDomForPrompts() {
      try {
        const domConfig = config.dom;
        if (!domConfig) return;

        let promptFound = false;

        for (const selector of domConfig.promptSelectors) {
          const dialogs = document.querySelectorAll(selector);
          for (const dialog of dialogs) {
            const text = (dialog.textContent || '').toLowerCase();
            const hasInteractiveButton = domConfig.interactiveButtonTexts.some((btnText) =>
              text.includes(btnText)
            );

            if (hasInteractiveButton) {
              const rect = dialog.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                promptFound = true;
                break;
              }
            }
          }
          if (promptFound) break;
        }

        adapter.setNeedsInput(promptFound);
      } catch (err) {
        adapter.log('DOM check error:', err);
      }
    }

    function setupDomObserver() {
      const container = document.querySelector('main') || document.body || document.documentElement;
      if (!container) {
        setTimeout(setupDomObserver, 150);
        return;
      }

      const observer = new MutationObserver((mutations) => {
        let isRelevant = false;
        for (let i = 0; i < mutations.length; i++) {
          const m = mutations[i];
          if (m.type === 'childList' || m.type === 'attributes') {
            isRelevant = true;
            break;
          }
        }
        if (isRelevant) {
          scheduleDomCheck();
        }
      });

      observer.observe(container, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ['class', 'style', 'role', 'aria-hidden']
      });

      scheduleDomCheck();
    }

    // ==========================================
    // Layer 3: Title Change Cross-Check
    // ==========================================

    let lastTitle = document.title;

    function setupTitleObserver() {
      const titleEl = document.querySelector('title');
      if (!titleEl) {
        setTimeout(setupTitleObserver, 200);
        return;
      }

      const titleObserver = new MutationObserver(() => {
        const currentTitle = document.title;
        if (currentTitle !== lastTitle) {
          adapter.log(`Layer 3: Title changed to "${currentTitle}"`);

          if (adapter.activeStreamsCount > 0 && !currentTitle.toLowerCase().includes('chatgpt')) {
            adapter.log(`Layer 3 Cross-Check: Disagreement detected between active streams (${adapter.activeStreamsCount}) and page title ("${currentTitle}")`);
          }

          lastTitle = currentTitle;
        }
      });

      titleObserver.observe(titleEl, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        setupDomObserver();
        setupTitleObserver();
      });
    } else {
      setupDomObserver();
      setupTitleObserver();
    }

  } catch (err) {
    console.error('[ai-island:chatgpt] Initialization error (isolated):', err);
  }
})();
