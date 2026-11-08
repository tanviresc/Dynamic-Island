// Shared Adapter Core (Layer 1 stream handling, debounce, deduplication, debug logging)
(function (global) {
  'use strict';

  class AdapterCore {
    constructor(config) {
      this.config = Object.assign({
        site: 'claude',
        debounceMs: 300,
        debug: true
      }, config);

      this.lastSentType = null;
      this.pendingFinishedTimer = null;
      this.activeStreamsCount = 0;
      this.needsInputActive = false;
      this.userClickedStop = false;
      this.lastTaskContext = null;
    }

    log(...args) {
      if (this.config.debug) {
        console.log(`[ai-island:${this.config.site}]`, ...args);
      }
    }

    getConversationTitle() {
      let rawTitle = document.title || '';
      if (typeof this.config.cleanTitle === 'function') {
        rawTitle = this.config.cleanTitle(rawTitle);
      }
      return rawTitle.trim() || 'Conversation';
    }

    extractIntent(rawPrompt, fallbackTitle = '') {
      if (!rawPrompt || typeof rawPrompt !== 'string' || !rawPrompt.trim()) {
        return fallbackTitle || 'Conversation';
      }

      // 1. Clean raw prompt: remove HTML tags, code blocks, URLs
      let text = rawPrompt
        .replace(/<[^>]+>/g, ' ')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]+`/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!text) {
        return fallbackTitle || 'Conversation';
      }

      const lower = text.toLowerCase();

      // 2. Intent matching for common AI tasks
      // Picture / Image generation
      if (
        (/\b(?:picture|image|photo|drawing|illustration|sketch|portrait|wallpaper|diagram|artwork|graphic|banner|thumbnail)\b/i.test(lower) &&
         /\b(?:generate|create|make|draw|render|produce|design|show|paint|sketch)\b/i.test(lower)) ||
        /\b(?:text to image|image generation|picture generation|dall-e|midjourney|imagen)\b/i.test(lower)
      ) {
        return 'Picture generation';
      }

      // PDF generation / conversion
      if (
        (/\bpdf\b/i.test(lower) &&
         /\b(?:generate|create|make|export|convert|save|download|write|produce)\b/i.test(lower)) ||
        /\b(?:pdf generation|pdf creation|export to pdf|save as pdf)\b/i.test(lower)
      ) {
        return 'PDF generation';
      }

      // Document / Data analysis
      if (
        (/\b(?:csv|excel|spreadsheet|dataset|dataframe|sheet|data)\b/i.test(lower) &&
         /\b(?:analyze|analysis|examine|inspect|process|visualize|plot|chart|evaluate|audit)\b/i.test(lower)) ||
        /\b(?:document analysis|data analysis)\b/i.test(lower)
      ) {
        return 'Document analysis';
      }

      // Code generation & programming
      if (
        /\b(?:code|function|script|algorithm|component|class|program|endpoint|api|database|query|sql)\b/i.test(lower) &&
        /\b(?:write|generate|create|build|implement|develop|code)\b/i.test(lower)
      ) {
        return 'Code generation';
      }

      // Bug fix & debugging
      if (
        /\b(?:bug|error|issue|glitch|problem|crash|exception|failure)\b/i.test(lower) &&
        /\b(?:fix|solve|resolve|debug|repair|patch)\b/i.test(lower)
      ) {
        return 'Bug fix';
      }

      // Refactoring
      if (/\b(?:refactor|clean up|optimize|reorganize|restructure|modularize)\b/i.test(lower)) {
        return 'Refactoring';
      }

      // Summarization
      if (/\b(?:summarize|summary|tldr|brief|recap|condense)\b/i.test(lower)) {
        return 'Summary generation';
      }

      // Translation
      if (/\b(?:translate|translation)\b/i.test(lower)) {
        return 'Translation';
      }

      // Audio / Speech
      if (
        /\b(?:audio|voice|speech|tts|podcast|song|sound)\b/i.test(lower) &&
        /\b(?:generate|create|make|synthesize|record)\b/i.test(lower)
      ) {
        return 'Audio generation';
      }

      // Video / Animation
      if (
        /\b(?:video|clip|animation)\b/i.test(lower) &&
        /\b(?:generate|create|make|render|produce)\b/i.test(lower)
      ) {
        return 'Video generation';
      }

      // 3. Clean action extraction if none of specific categories match
      let cleaned = text
        .replace(/^(?:please|can you|could you|would you|will you|help me to|help me|i want you to|i need you to|i'd like you to|tell me|give me|show me|how to|what is|write a|generate a|create a)\s+/i, '')
        .trim();

      cleaned = cleaned.replace(/^(?:hi|hello|hey|greetings|claude|chatgpt|gemini)[,\s:]+/i, '').trim();
      cleaned = cleaned.split(/[.?!\n;]/)[0].trim();

      if (cleaned.length >= 3) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        if (cleaned.length > 45) {
          cleaned = cleaned.slice(0, 42).trimEnd() + '...';
        }
        return cleaned;
      }

      return fallbackTitle || 'Conversation';
    }

    detectTaskContext() {
      let rawPrompt = '';

      // 1. Check recent user message DOM elements
      const userSelectors = [
        '[data-message-author-role="user"]',
        'div.font-user-message',
        'div[data-testid*="user-message"]',
        'div[class*="user-message"]',
        'user-query',
        '.query-text',
        'div[class*="user-query"]',
        'div[class*="query-content"]'
      ];

      for (const sel of userSelectors) {
        try {
          const els = document.querySelectorAll(sel);
          if (els && els.length > 0) {
            const last = els[els.length - 1];
            const text = (last.textContent || '').trim();
            if (text && text.length >= 3) {
              rawPrompt = text;
              break;
            }
          }
        } catch (_) {}
      }

      // 2. If not found in messages, check prompt input area
      if (!rawPrompt) {
        const inputSelectors = [
          '#prompt-textarea',
          'div[contenteditable="true"]',
          'rich-textarea textarea',
          'textarea[placeholder*="Reply"]',
          'textarea[placeholder*="Claude"]',
          'textarea[placeholder*="Ask"]',
          'textarea'
        ];
        for (const sel of inputSelectors) {
          try {
            const el = document.querySelector(sel);
            if (el) {
              const text = (el.value || el.textContent || '').trim();
              if (text && text.length >= 3) {
                rawPrompt = text;
                break;
              }
            }
          } catch (_) {}
        }
      }

      const fallbackTitle = this.getConversationTitle();
      return this.extractIntent(rawPrompt, fallbackTitle);
    }

    classifyTaskKind(isStopped = false) {
      try {
        const site = this.config.site || 'claude';
        const rules = this.config.classificationRules || {
          priorityOrder: [
            'image', 'pdf', 'spreadsheet', 'slides', 'document', 'code',
            'translation', 'summary', 'rewrite', 'research', 'question'
          ],
          keywords: {
            image: ['picture', 'image', 'photo', 'draw', 'drawing', 'logo', 'illustration', 'sketch', 'portrait', 'wallpaper', 'diagram', 'graphic', 'artwork', 'dall-e', 'midjourney', 'imagen', 'banner', 'thumbnail', 'ছবি', 'ইমেজ', 'আঁকো', 'চিত্র', 'ড্রয়িং', 'লোগো'],
            pdf: ['pdf', '.pdf', 'export to pdf', 'save as pdf', 'make a pdf', 'download as pdf', 'convert to pdf', 'পিডিএফ'],
            spreadsheet: ['excel', 'spreadsheet', 'csv', 'xlsx', '.csv', '.xlsx', 'sheet', 'dataframe', 'table data', 'এক্সেল', 'স্প্রেডশিট'],
            slides: ['slides', 'presentation', 'powerpoint', 'ppt', 'pptx', '.ppt', '.pptx', 'pitch deck', 'slide deck', 'ডেক', 'প্রেজেন্টেশন', 'স্লাইড'],
            document: ['word', 'docx', '.docx', 'doc', 'report', 'essay', 'article', 'write a doc', 'document', 'ডকুমেন্ট', 'প্রতিবেদন', 'রিপোর্ট', 'প্রবন্ধ'],
            code: ['code', 'script', 'function', 'bug', 'fix', 'debug', 'algorithm', 'component', 'class', 'endpoint', 'api', 'query', 'sql', 'program', 'python', 'javascript', 'typescript', 'rust', 'html', 'css', 'কোড', 'স্ক্রিপ্ট', 'ফাংশন', 'বাগ', 'ফিক্স'],
            research: ['research', 'search', 'find sources', 'citations', 'literature review', 'investigate', 'deep dive', 'গবেষণা', 'অনুসন্ধান', 'উৎস'],
            translation: ['translate', 'translation', 'english to', 'bengali to', 'spanish to', 'in french', 'in german', 'অনুবাদ', 'বাংলায় অনুবাদ', 'ট্রান্সলেট'],
            summary: ['summarize', 'summary', 'tldr', 'tl;dr', 'brief', 'digest', 'recap', 'key takeaways', 'সারসংক্ষেপ', 'সংক্ষেপ', 'সারাংশ'],
            rewrite: ['rewrite', 'rephrase', 'paraphrase', 'reword', 'polish this', 'improve writing', 'পুনরায় লিখুন', 'রিরাইট', 'প্যারাফ্রেজ']
          }
        };

        // 1. Signal 2: Response structure (if not stopped)
        if (!isStopped) {
          const structureResult = this.checkResponseStructure(site);
          if (structureResult) {
            this.log(`kind=${structureResult.kind} reason=${structureResult.reason}`);
            return structureResult.kind;
          }
        }

        // 2. Signal 1: Prompt keywords from user prompt
        const promptKeywordResult = this.checkPromptKeywords(rules);
        if (promptKeywordResult) {
          this.log(`kind=${promptKeywordResult.kind} reason=${promptKeywordResult.reason}`);
          return promptKeywordResult.kind;
        }

        // 3. Fallback to question
        this.log('kind=question reason=default-question');
        return 'question';
      } catch (err) {
        this.log('kind=question reason=classifier-fallback-error');
        return 'question';
      }
    }

    checkResponseStructure(site) {
      try {
        const assistantSelectors = [
          'div.font-claude-message',
          '[data-message-author-role="assistant"]',
          'div[data-is-streaming]',
          'article[data-testid*="conversation-turn"]:last-of-type',
          'div.agent-turn',
          'model-response',
          'message-content',
          'div.model-turn',
          'div.response-container'
        ];

        let latestContainer = null;
        for (const sel of assistantSelectors) {
          const els = document.querySelectorAll(sel);
          if (els && els.length > 0) {
            latestContainer = els[els.length - 1];
            break;
          }
        }

        const scope = latestContainer || document.body;

        // Image check (non-avatar)
        const img = scope.querySelector("img:not([alt*='avatar']):not([class*='avatar']):not([src*='avatar']):not([width='16']):not([width='20']):not([width='24']), image-card img, img[alt*='Generated by DALL']");
        if (img) {
          return { kind: 'image', reason: 'img-in-response' };
        }

        // File chip by extension
        const links = scope.querySelectorAll("a[href], a[download], [data-testid*='attachment'], [data-testid*='artifact']");
        for (const link of links) {
          const href = (link.getAttribute('href') || link.getAttribute('download') || link.getAttribute('data-testid') || '').toLowerCase();
          if (href.includes('.pdf')) return { kind: 'pdf', reason: 'file-chip-pdf' };
          if (href.includes('.xlsx') || href.includes('.csv')) return { kind: 'spreadsheet', reason: 'file-chip-spreadsheet' };
          if (href.includes('.pptx') || href.includes('.ppt')) return { kind: 'slides', reason: 'file-chip-slides' };
          if (href.includes('.docx') || href.includes('.doc')) return { kind: 'document', reason: 'file-chip-document' };
        }

        // Artifact / canvas panel
        const artifact = document.querySelector("div[data-testid*='artifact'], div[data-testid*='canvas'], div.artifact-container");
        if (artifact) {
          if (artifact.querySelector('pre, code')) {
            return { kind: 'code', reason: 'artifact-code' };
          }
          return { kind: 'document', reason: 'artifact-document' };
        }

        // Code blocks
        const code = scope.querySelector('pre code, code-block, div.font-mono pre, div.bg-black pre');
        if (code) {
          return { kind: 'code', reason: 'code-in-response' };
        }
      } catch (_) {}
      return null;
    }

    getUserLastPromptText() {
      const userSelectors = [
        '[data-message-author-role="user"]',
        'div.font-user-message',
        'div[data-testid*="user-message"]',
        'div[class*="user-message"]',
        'user-query',
        '.query-text',
        'div[class*="user-query"]',
        'div[class*="query-content"]'
      ];

      for (const sel of userSelectors) {
        try {
          const els = document.querySelectorAll(sel);
          if (els && els.length > 0) {
            const last = els[els.length - 1];
            const text = (last.textContent || '').trim();
            if (text && text.length >= 2) {
              return text;
            }
          }
        } catch (_) {}
      }

      const inputSelectors = [
        '#prompt-textarea',
        'div[contenteditable="true"]',
        'rich-textarea textarea',
        'textarea[placeholder*="Reply"]',
        'textarea[placeholder*="Claude"]',
        'textarea[placeholder*="Ask"]',
        'textarea'
      ];

      for (const sel of inputSelectors) {
        try {
          const el = document.querySelector(sel);
          if (el) {
            const text = (el.value || el.textContent || '').trim();
            if (text && text.length >= 2) {
              return text;
            }
          }
        } catch (_) {}
      }
      return '';
    }

    checkPromptKeywords(rules) {
      try {
        const text = this.getUserLastPromptText();
        if (!text) return null;

        for (const kind of rules.priorityOrder) {
          if (kind === 'question') continue;
          const kwList = rules.keywords?.[kind] || [];
          for (const kw of kwList) {
            let matched = false;
            if (/^[a-zA-Z0-9_-]+$/.test(kw)) {
              matched = new RegExp(`\\b${kw}\\b`, 'i').test(text);
            } else {
              matched = text.toLowerCase().includes(kw.toLowerCase());
            }
            if (matched) {
              return { kind, reason: `prompt-keyword-${kw}` };
            }
          }
        }
      } catch (_) {}
      return null;
    }

    formatMessage(type, kind = 'question') {
      const templates = {
        image: {
          finished: 'Picture is ready',
          stopped: 'Picture generation stopped',
          working: 'Generating picture...',
          needs_input: 'Permission needed for picture',
          limit_reached: 'Picture limit reached'
        },
        pdf: {
          finished: 'PDF is ready',
          stopped: 'PDF generation stopped',
          working: 'Generating PDF...',
          needs_input: 'Permission needed for PDF',
          limit_reached: 'PDF limit reached'
        },
        document: {
          finished: 'Document is ready',
          stopped: 'Document generation stopped',
          working: 'Generating document...',
          needs_input: 'Permission needed for document',
          limit_reached: 'Document limit reached'
        },
        spreadsheet: {
          finished: 'Spreadsheet is ready',
          stopped: 'Spreadsheet generation stopped',
          working: 'Generating spreadsheet...',
          needs_input: 'Permission needed for spreadsheet',
          limit_reached: 'Spreadsheet limit reached'
        },
        slides: {
          finished: 'Presentation is ready',
          stopped: 'Presentation generation stopped',
          working: 'Generating presentation...',
          needs_input: 'Permission needed for presentation',
          limit_reached: 'Presentation limit reached'
        },
        code: {
          finished: 'Code is ready',
          stopped: 'Code generation stopped',
          working: 'Generating code...',
          needs_input: 'Permission needed for code',
          limit_reached: 'Code limit reached'
        },
        research: {
          finished: 'Research is ready',
          stopped: 'Research stopped',
          working: 'Researching...',
          needs_input: 'Permission needed for research',
          limit_reached: 'Research limit reached'
        },
        translation: {
          finished: 'Translation is ready',
          stopped: 'Translation stopped',
          working: 'Translating...',
          needs_input: 'Permission needed for translation',
          limit_reached: 'Translation limit reached'
        },
        summary: {
          finished: 'Summary is ready',
          stopped: 'Summary stopped',
          working: 'Generating summary...',
          needs_input: 'Permission needed for summary',
          limit_reached: 'Summary limit reached'
        },
        rewrite: {
          finished: 'Rewrite is ready',
          stopped: 'Rewrite stopped',
          working: 'Rewriting...',
          needs_input: 'Permission needed for rewrite',
          limit_reached: 'Rewrite limit reached'
        },
        question: {
          finished: 'Answer is ready: see the answer to your question',
          stopped: 'Answer was stopped',
          working: 'Answering your question...',
          needs_input: 'Permission or input required',
          limit_reached: 'Usage limit reached'
        }
      };

      const k = templates[kind] ? kind : 'question';
      return templates[k][type] || templates.question[type] || `${type}`;
    }

    isLimitText(text) {
      if (!text || typeof text !== 'string') return false;
      const t = text.toLowerCase().trim();

      return (
        /you(?:'ve| have) (?:reached|hit|exceeded) (?:your |the |our )?(?:usage |daily |message |free (?:plan |message )?)?limit/i.test(t) ||
        /out of free messages/i.test(t) ||
        /free message limit/i.test(t) ||
        /(?:message|usage|rate|daily|hourly) limit (?:reached|exceeded)/i.test(t) ||
        /quota (?:has been )?exceeded/i.test(t) ||
        /resource_exhausted/i.test(t) ||
        /rate_limit(?:_exceeded)?/i.test(t) ||
        /too many requests/i.test(t) ||
        /hit a rate limit/i.test(t) ||
        /claude is at capacity/i.test(t)
      );
    }

    checkDomForLimit() {
      try {
        // Only check active, visible error banners and alertdialogs
        const bannerSelectors = [
          '[role="alert"]',
          '[role="alertdialog"]',
          'div[data-testid*="error"]',
          'div[class*="error-message"]',
          'div[class*="banner-error"]',
          'div[class*="toast-error"]'
        ];

        for (const sel of bannerSelectors) {
          const els = document.querySelectorAll(sel);
          for (const el of els) {
            // Must be visible on screen with non-zero dimensions
            if (el.offsetWidth > 0 && el.offsetHeight > 0) {
              const txt = el.textContent || '';
              if (this.isLimitText(txt)) {
                this.log(`DOM limit pattern matched in active visible alert (${sel})`);
                return true;
              }
            }
          }
        }
      } catch (err) {
        this.log('Error in checkDomForLimit:', err);
      }
      return false;
    }

    emitEvent(type) {
      // Deduplication: do not send same type consecutively
      if (this.lastSentType === type) {
        this.log(`Dropped duplicate event: ${type}`);
        return;
      }

      this.lastSentType = type;
      const isStopped = (type === 'stopped');
      const taskKind = this.classifyTaskKind(isStopped);
      const message = this.formatMessage(type, taskKind);

      this.log(`-> DISPATCH EVENT: ${type} [kind=${taskKind}] ("${message}")`);

      window.postMessage({
        source: `ai-island-${this.config.site}`,
        site: this.config.site,
        type: type,
        taskKind: taskKind,
        message: message,
        timestamp: Date.now()
      }, '*');
    }

    onStreamStart(url) {
      this.activeStreamsCount++;
      this.userClickedStop = false; // Reset stop flag on new stream
      this.lastTaskContext = this.detectTaskContext();
      this.log(`Stream started (${this.activeStreamsCount} active) for ${url}`);

      // Cancel any pending finished event since generation is still active
      if (this.pendingFinishedTimer) {
        this.log('Cancelled pending finished timer because new stream started');
        clearTimeout(this.pendingFinishedTimer);
        this.pendingFinishedTimer = null;
      }

      this.emitEvent('working');
    }

    onStreamDone(url) {
      this.activeStreamsCount = Math.max(0, this.activeStreamsCount - 1);
      this.log(`Stream ended (${this.activeStreamsCount} active) for ${url}`);

      if (this.activeStreamsCount === 0) {
        // Start debounce timer
        if (this.pendingFinishedTimer) clearTimeout(this.pendingFinishedTimer);
        this.log(`Scheduling "finished" candidate in ${this.config.debounceMs}ms`);

        this.pendingFinishedTimer = setTimeout(() => {
          this.pendingFinishedTimer = null;
          if (this.activeStreamsCount === 0) {
            // Completed stream always cleanly finishes
            this.emitEvent('finished');
          }
        }, this.config.debounceMs);
      }
    }

    onStreamAbort(url, reason) {
      this.activeStreamsCount = Math.max(0, this.activeStreamsCount - 1);
      this.log(`Stream aborted/stopped (${reason}) for ${url}`);

      if (this.pendingFinishedTimer) {
        clearTimeout(this.pendingFinishedTimer);
        this.pendingFinishedTimer = null;
      }

      // If user did not manually click stop, check if abort was due to an active limit alert
      if (!this.userClickedStop && this.checkDomForLimit()) {
        this.emitEvent('limit_reached');
      } else {
        this.emitEvent('stopped');
      }
    }

    markUserStopped() {
      this.log('User clicked Stop button');
      this.userClickedStop = true;
      this.onStreamAbort('user_clicked_stop');
    }

    onLimitReached(url, status) {
      this.activeStreamsCount = Math.max(0, this.activeStreamsCount - 1);
      this.log(`Usage limit reached (HTTP ${status}) for ${url}`);

      if (this.pendingFinishedTimer) {
        clearTimeout(this.pendingFinishedTimer);
        this.pendingFinishedTimer = null;
      }

      this.emitEvent('limit_reached');
    }

    setNeedsInput(active) {
      if (active && !this.needsInputActive) {
        this.needsInputActive = true;
        this.emitEvent('needs_input');
      } else if (!active && this.needsInputActive) {
        this.needsInputActive = false;
        this.emitEvent('resolve_needs_input');
      }
    }

    // Zero-overhead stream watcher: tracks completion and user abort cleanly without response.clone()
    watchStreamResponse(response, url, signal) {
      if (!response.body) {
        this.onStreamDone(url);
        return response;
      }

      const self = this;
      let isCompleted = false;

      const finishStream = () => {
        if (isCompleted) return;
        isCompleted = true;
        if (self.userClickedStop) {
          self.onStreamAbort(url, 'aborted');
        } else {
          self.onStreamDone(url);
        }
      };

      const abortStream = (reason) => {
        if (isCompleted) return;
        isCompleted = true;
        if (self.userClickedStop) {
          self.onStreamAbort(url, reason || 'aborted');
        } else {
          // If the user did not click Stop, internal socket termination is routine client cleanup
          self.onStreamDone(url);
        }
      };

      // Watch AbortSignal
      if (signal) {
        signal.addEventListener('abort', () => {
          if (self.userClickedStop) {
            abortStream('aborted');
          } else {
            finishStream();
          }
        }, { once: true });
      }

      const originalGetReader = response.body.getReader.bind(response.body);

      response.body.getReader = function (...readerArgs) {
        const reader = originalGetReader(...readerArgs);
        const originalRead = reader.read.bind(reader);
        const originalCancel = reader.cancel ? reader.cancel.bind(reader) : null;

        reader.read = function () {
          return originalRead().then((result) => {
            if (result.done) {
              finishStream();
            }
            return result;
          }).catch((err) => {
            if (self.userClickedStop) {
              abortStream('aborted');
            } else {
              finishStream();
            }
            throw err;
          });
        };

        if (originalCancel) {
          reader.cancel = function (...cancelArgs) {
            if (self.userClickedStop) {
              abortStream('aborted');
            } else {
              finishStream();
            }
            return originalCancel(...cancelArgs);
          };
        }

        return reader;
      };

      return response;
    }
  }

  global.AiIslandCore = AdapterCore;
})(window);
