// AI Island - Main World Injected Script for Google Gemini (gemini.google.com)
(function () {
  'use strict';

  try {
    if (window.__aiIslandGeminiInjected) return;
    window.__aiIslandGeminiInjected = true;

    const config = window.GeminiAdapterConfig || {
      site: 'gemini',
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
    adapter.log('Injected page script initialized in MAIN world (Gemini)');

    // ==========================================
    // User Interaction Tracking (Prevents Reload False-Triggers)
    // ==========================================

    let userSubmittedPrompt = false;
    let promptSubmitTime = 0;

    function isRecentPromptActive() {
      // Must be initiated by user within the last 60 seconds
      return userSubmittedPrompt && (Date.now() - promptSubmitTime < 60000);
    }

    // 1. Track Enter key in chat input box
    window.addEventListener('keydown', (e) => {
      try {
        if (e.key === 'Enter' && !e.shiftKey) {
          const target = e.target;
          if (target && (target.tagName === 'TEXTAREA' || target.isContentEditable || target.getAttribute('role') === 'textbox')) {
            userSubmittedPrompt = true;
            promptSubmitTime = Date.now();
            adapter.log('User submitted prompt via Enter key');
          }
        }
      } catch (err) {}
    }, true);

    // 2. Track Send button and Stop button clicks
    window.addEventListener('click', (e) => {
      try {
        const btn = e.target && e.target.closest ? e.target.closest('button, [role="button"]') : null;
        if (!btn) return;

        const label = (btn.getAttribute('aria-label') || '').toLowerCase();
        const testId = (btn.getAttribute('data-test-id') || btn.getAttribute('data-testid') || '').toLowerCase();
        const cls = (btn.className || '').toLowerCase();

        // Check if Send button was clicked
        if (
          label.includes('send') ||
          testId.includes('send') ||
          cls.includes('send') ||
          btn.querySelector('mat-icon[data-mat-icon-name="send"]')
        ) {
          userSubmittedPrompt = true;
          promptSubmitTime = Date.now();
          adapter.log('User submitted prompt via Send button');
        }

        // Check if Stop button was clicked
        if (
          testId === 'stop-button' ||
          label === 'stop response' ||
          label === 'stop generation' ||
          label === 'stop streaming' ||
          label === 'stop' ||
          btn.querySelector('mat-icon[fonticon="stop"]')
        ) {
          adapter.markUserStopped();
        }
      } catch (err) {}
    }, true);

    // ==========================================
    // Layer 1: Network & Stream Interception
    // ==========================================

    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      let url = '';
      let method = 'GET';
      let body = null;
      let signal = null;
      const startTime = performance.now();

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
          if (args[1].body) body = args[1].body;
          if (args[1].signal) signal = args[1].signal;
        }
      } catch (e) {}

      // Only evaluate as a generation endpoint if the user actually submitted a prompt (blocks page-load pings!)
      const isCandidateEndpoint = config.isStreamRequest(url, method, body);
      const isGenerationEndpoint = isRecentPromptActive() && isCandidateEndpoint;

      if (isGenerationEndpoint) {
        adapter.onStreamStart(url);
      }

      let response;
      try {
        response = await originalFetch.apply(this, args);
      } catch (err) {
        const durationMs = Math.round(performance.now() - startTime);
        if (isGenerationEndpoint) {
          adapter.log(`fetch FAILED: ${method} ${url} (duration: ${durationMs}ms, error: ${err.message})`);
          userSubmittedPrompt = false;
          if (adapter.userClickedStop) {
            adapter.onStreamAbort(url, 'aborted');
          } else {
            adapter.onStreamDone(url);
          }
        }
        throw err;
      }

      try {
        const durationMs = Math.round(performance.now() - startTime);
        const contentType = (response.headers && response.headers.get('content-type')) || '';
        const status = response.status;

        if (isGenerationEndpoint) {
          adapter.log(`fetch: ${method} ${url} (status: ${status}, duration: ${durationMs}ms, type: ${contentType})`);
        }

        if (status === 429) {
          if (isGenerationEndpoint) {
            userSubmittedPrompt = false;
            adapter.onLimitReached(url, status);
          }
        } else if (status >= 400) {
          if (isGenerationEndpoint) {
            userSubmittedPrompt = false;
            adapter.onStreamAbort(url, `HTTP ${status}`);
          }
        } else if (response.ok && isGenerationEndpoint) {
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
      const reqBody = body && body[0] ? body[0] : null;
      const startTime = performance.now();

      const isCandidateEndpoint = config.isStreamRequest(url, method, reqBody);
      const isGenerationEndpoint = isRecentPromptActive() && isCandidateEndpoint;

      if (isGenerationEndpoint) {
        adapter.onStreamStart(url);

        this.addEventListener('load', () => {
          userSubmittedPrompt = false;
          const durationMs = Math.round(performance.now() - startTime);
          const contentType = this.getResponseHeader('content-type') || '';
          adapter.log(`xhr load: ${method} ${url} (status: ${this.status}, duration: ${durationMs}ms, type: ${contentType})`);

          if (this.status === 429) {
            adapter.onLimitReached(url, this.status);
          } else if (this.status >= 200 && this.status < 300) {
            if (adapter.userClickedStop) {
              adapter.onStreamAbort(url, 'aborted');
            } else {
              adapter.onStreamDone(url);
            }
          } else {
            adapter.onStreamAbort(url, `HTTP ${this.status}`);
          }
        });

        this.addEventListener('abort', () => {
          userSubmittedPrompt = false;
          const durationMs = Math.round(performance.now() - startTime);
          adapter.log(`xhr abort: ${method} ${url} (duration: ${durationMs}ms)`);
          if (adapter.userClickedStop) {
            adapter.onStreamAbort(url, 'aborted');
          } else {
            adapter.onStreamDone(url);
          }
        });

        this.addEventListener('error', () => {
          userSubmittedPrompt = false;
          const durationMs = Math.round(performance.now() - startTime);
          adapter.log(`xhr error: ${method} ${url} (duration: ${durationMs}ms)`);
          adapter.onStreamAbort(url, 'error');
        });
      }

      return originalXHRSend.apply(this, body);
    };

    // ==========================================
    // Layer 2: Lightweight Throttled DOM Watching
    // ==========================================

    let domCheckTimeout = null;
    let wasGeneratingByDom = false;

    function scheduleDomCheck() {
      if (domCheckTimeout) return;
      domCheckTimeout = setTimeout(() => {
        domCheckTimeout = null;
        checkDomForState();
      }, 200);
    }

    function checkDomForState() {
      try {
        // 1. Cross-check for Stop button presence ONLY if a user prompt is active
        const stopBtn = document.querySelector('button[aria-label="Stop response" i], button[aria-label="Stop generation" i], button[aria-label="Stop streaming" i], button[data-test-id="stop-button" i], button.stop-button');
        const isGeneratingNow = isRecentPromptActive() && Boolean(stopBtn && stopBtn.offsetParent !== null && !stopBtn.disabled);

        if (isGeneratingNow && !wasGeneratingByDom) {
          wasGeneratingByDom = true;
          adapter.log('DOM observer: Stop button appeared -> working');
          adapter.onStreamStart('dom:generating');
        } else if (!isGeneratingNow && wasGeneratingByDom) {
          wasGeneratingByDom = false;
          userSubmittedPrompt = false;
          adapter.log('DOM observer: Stop button disappeared -> finished');
          if (adapter.userClickedStop) {
            adapter.onStreamAbort('dom:stop_clicked', 'aborted');
          } else {
            adapter.onStreamDone('dom:finished');
          }
        }

        // 2. Check for permission / confirmation dialogs ("needs_input")
        const domConfig = config.dom;
        if (domConfig) {
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
        }
      } catch (err) {
        adapter.log('DOM check error:', err);
      }
    }

    function setupDomObserver() {
      const container = document.querySelector('main') || document.querySelector('[role="main"]') || document.body || document.documentElement;
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
        attributeFilter: ['class', 'style', 'role', 'aria-hidden', 'aria-label', 'disabled']
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

          if (adapter.activeStreamsCount > 0 && !currentTitle.toLowerCase().includes('gemini')) {
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
    console.error('[ai-island:gemini] Initialization error (isolated):', err);
  }
})();
