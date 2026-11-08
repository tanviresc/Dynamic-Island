// Test panel controller (Tasks 1 - 7, 12)
let selectedSite = 'claude';
let selectedSource = 'web';
let isFsSimulated = false;

function broadcastEvent(eventName, payload) {
  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
    window.__TAURI__.core.invoke('emit_island_event', {
      event: eventName,
      payload: payload
    }).catch(e => console.warn('Invoke emit_island_event failed:', e));
  }

  if (window.__TAURI__ && window.__TAURI__.event) {
    if (window.__TAURI__.event.emit) {
      window.__TAURI__.event.emit(eventName, payload).catch(() => {});
    }
    if (window.__TAURI__.event.emitTo) {
      window.__TAURI__.event.emitTo('main', eventName, payload).catch(() => {});
    }
  }
}

function getActiveTaskId() {
  const input = document.getElementById('task-id-input');
  if (input && input.value.trim().length > 0) {
    return input.value.trim();
  }
  return undefined;
}

function getActiveTaskKind() {
  const select = document.getElementById('task-kind-select');
  return select ? select.value : 'question';
}

function sendNotification(type, message, siteOverride, sourceOverride, taskIdOverride, taskKindOverride) {
  const tid = taskIdOverride !== undefined ? taskIdOverride : getActiveTaskId();
  const kind = taskKindOverride !== undefined ? taskKindOverride : getActiveTaskKind();
  broadcastEvent('island-notification-event', {
    type,
    site: siteOverride || selectedSite,
    source: sourceOverride || selectedSource,
    taskKind: kind,
    message: message || undefined,
    taskId: tid
  });
}

function setupControls() {
  // 1. Site selector
  const sites = ['claude', 'chatgpt', 'gemini', 'antigravity'];
  sites.forEach(site => {
    const btn = document.getElementById(`site-${site}`);
    if (btn) {
      btn.addEventListener('click', () => {
        selectedSite = site;
        sites.forEach(s => {
          const b = document.getElementById(`site-${s}`);
          if (b) {
            b.className = s === site ? `site-btn active-${s}` : 'site-btn';
          }
        });
      });
    }
  });

  // Source selector
  const sources = ['web', 'desktop', 'ide'];
  sources.forEach(src => {
    const btn = document.getElementById(`src-${src}`);
    if (btn) {
      btn.addEventListener('click', () => {
        selectedSource = src;
        sources.forEach(s => {
          const b = document.getElementById(`src-${s}`);
          if (b) {
            b.className = s === src ? 'source-btn active-source' : 'source-btn';
          }
        });
      });
    }
  });

  // 2. Notification type actions
  const bind = (id, fn) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('click', fn);
  };

  bind('notif-working', () => {
    sendNotification('working');
  });

  bind('notif-finished', () => {
    sendNotification('finished');
  });

  bind('notif-stopped', () => {
    sendNotification('stopped');
  });

  bind('notif-needs-input', () => {
    sendNotification('needs_input');
  });

  bind('notif-limit-reached', () => {
    sendNotification('limit_reached');
  });

  bind('notif-resolve', () => {
    broadcastEvent('island-resolve-needs-input', { site: selectedSite, taskId: getActiveTaskId() });
  });

  bind('notif-clear-all', () => {
    broadcastEvent('island-clear-all-states', {});
  });

  // Task Kind Template Tests
  bind('test-pic-done', () => {
    sendNotification('finished', null, null, null, null, 'image');
  });
  bind('test-pic-stopped', () => {
    sendNotification('stopped', null, null, null, null, 'image');
  });
  bind('test-pdf-done', () => {
    sendNotification('finished', null, null, null, null, 'pdf');
  });
  bind('test-pdf-stopped', () => {
    sendNotification('stopped', null, null, null, null, 'pdf');
  });
  bind('test-code-done', () => {
    sendNotification('finished', null, null, null, null, 'code');
  });
  bind('test-research-done', () => {
    sendNotification('finished', null, null, null, null, 'research');
  });
  bind('test-trans-done', () => {
    sendNotification('finished', null, null, null, null, 'translation');
  });
  bind('test-summary-done', () => {
    sendNotification('finished', null, null, null, null, 'summary');
  });
  bind('test-question-done', () => {
    sendNotification('finished', null, null, null, null, 'question');
  });
  bind('test-question-stopped', () => {
    sendNotification('stopped', null, null, null, null, 'question');
  });

  // Task ID helpers
  const taskInput = document.getElementById('task-id-input');
  bind('btn-set-task-1', () => {
    if (taskInput) taskInput.value = 'task-1';
  });
  bind('btn-set-task-2', () => {
    if (taskInput) taskInput.value = 'task-2';
  });
  bind('btn-clear-task', () => {
    if (taskInput) taskInput.value = '';
  });

  // Antigravity Multi-Task verification buttons
  bind('ag-t1-working', () => {
    sendNotification('working', 'Working: Refactor auth module', 'antigravity', 'ide', 'task-1');
  });
  bind('ag-t1-needs-input', () => {
    sendNotification('needs_input', 'Needs you: Approve npm test command', 'antigravity', 'ide', 'task-1');
  });
  bind('ag-t2-working', () => {
    sendNotification('working', 'Working: Fix css layout glitch', 'antigravity', 'ide', 'task-2');
  });
  bind('ag-t2-done', () => {
    sendNotification('finished', 'Finished: Fix css layout glitch', 'antigravity', 'ide', 'task-2');
  });
  bind('ag-t2-stopped', () => {
    sendNotification('stopped', 'Stopped: Fix css layout glitch (cancelled)', 'antigravity', 'ide', 'task-2');
  });
  bind('ag-t1-resolve', () => {
    broadcastEvent('island-resolve-needs-input', { site: 'antigravity', taskId: 'task-1' });
  });

  // Replay Trace (Scenario A)
  bind('btn-replay-trace', async () => {
    const replayBtn = document.getElementById('btn-replay-trace');
    if (replayBtn) replayBtn.textContent = 'Replaying trace...';

    // 1. Initial turn event sets task to running (blue dot)
    broadcastEvent('island-notification-event', {
      type: 'working',
      site: 'antigravity',
      source: 'ide',
      message: 'Working: dynamic island',
      taskId: 'scenario-a'
    });

    // 2. Intermediate step events (read, edit, run) refresh activity timer
    for (let i = 1; i <= 5; i++) {
      await new Promise(r => setTimeout(r, 600));
      broadcastEvent('island-notification-event', {
        type: 'step',
        site: 'antigravity',
        source: 'ide',
        message: 'Working: dynamic island',
        taskId: 'scenario-a'
      });
    }

    if (replayBtn) replayBtn.textContent = 'Replaying: quiet-time wait (8s)...';

    setTimeout(() => {
      if (replayBtn) replayBtn.textContent = 'Replay Trace (Scenario A)';
    }, 8500);
  });

  // 3. Task 5: Queue Test (fires Claude, ChatGPT, and Gemini back-to-back)
  bind('btn-queue-test', () => {
    sendNotification('finished', 'Claude: document analysis completed', 'claude');
    setTimeout(() => {
      sendNotification('stopped', 'ChatGPT: script generation stopped', 'chatgpt');
    }, 150);
    setTimeout(() => {
      sendNotification('needs_input', 'Gemini: file write permission needed', 'gemini');
    }, 300);
  });

  // 4. Task 6 & 13: Fullscreen Simulation Toggle with Armed Cycle Status & Context
  const fsBtn = document.getElementById('btn-fs-toggle');
  const fsCycleStateEl = document.getElementById('fs-cycle-state');
  const ctxSelect = document.getElementById('context-simulate-select');
  let currentSimulatedContext = 'none';
  let currentFsPhase = 'not_armed';
  let currentFsSeconds = 0;

  function updateFsCycleStateUI(phase, secondsLeft, context) {
    if (phase !== undefined) currentFsPhase = phase;
    if (secondsLeft !== undefined) currentFsSeconds = secondsLeft;
    if (context !== undefined) {
      currentSimulatedContext = context;
      if (ctxSelect && ctxSelect.value !== context) {
        ctxSelect.value = context;
      }
    }

    if (!fsCycleStateEl) return;
    let cycleText = 'Not armed';
    let cycleColor = '#71717a';

    if (currentFsPhase === 'visible') {
      const secText = (currentFsSeconds != null && currentFsSeconds > 0) ? ` (${currentFsSeconds}s)` : ' (10s)';
      cycleText = `Visible${secText}`;
      const sec = typeof currentFsSeconds === 'number' ? currentFsSeconds : 10;
      cycleText = `Visible (${sec}s)`;
      cycleColor = '#4caf50';
    } else if (currentFsPhase === 'hidden') {
      const secText = (currentFsSeconds != null && currentFsSeconds > 0) ? ` (${currentFsSeconds}s)` : ' (45s)';
      cycleText = `Hidden${secText}`;
      const sec = typeof currentFsSeconds === 'number' ? currentFsSeconds : 45;
      cycleText = `Hidden (${sec}s)`;
      cycleColor = '#ff9800';
    } else {
      cycleText = 'Not armed';
      cycleColor = '#71717a';
    }

    const ctxLabel = (currentSimulatedContext && currentSimulatedContext !== 'none')
      ? ` [Context: ${currentSimulatedContext}]`
      : ' [Context: none]';

    fsCycleStateEl.textContent = `${cycleText}${ctxLabel}`;
    fsCycleStateEl.style.color = cycleColor;
  }

  if (fsBtn) {
    fsBtn.addEventListener('click', () => {
      isFsSimulated = !isFsSimulated;
      if (isFsSimulated) {
        fsBtn.classList.add('btn-fs-active');
        fsBtn.textContent = 'Simulate Fullscreen: ON';
      } else {
        fsBtn.classList.remove('btn-fs-active');
        fsBtn.textContent = 'Simulate Fullscreen: OFF';
        updateFsCycleStateUI('not_armed', 0, currentSimulatedContext);
      }
      broadcastEvent('island-simulate-fullscreen', { enabled: isFsSimulated });
    });
  }

  if (ctxSelect) {
    ctxSelect.addEventListener('change', () => {
      currentSimulatedContext = ctxSelect.value;
      updateFsCycleStateUI(currentFsPhase, currentFsSeconds, currentSimulatedContext);
      broadcastEvent('context-changed', { context: currentSimulatedContext });
      broadcastEvent('island-simulate-context', { context: currentSimulatedContext });
    });
  }

  if (window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.listen('fullscreen-cycle-status', (event) => {
      const payload = event.payload || {};
      updateFsCycleStateUI(payload.phase, payload.secondsLeft, payload.context);
    });
    window.__TAURI__.event.listen('context-changed', (event) => {
      const payload = event.payload || {};
      if (payload.context) {
        updateFsCycleStateUI(currentFsPhase, currentFsSeconds, payload.context);
      }
    });
    // Request initial cycle state on panel setup
    broadcastEvent('island-request-fullscreen-status', {});
  }

  // 5. Task 7: History Panel Toggle
  bind('btn-history-toggle', () => {
    broadcastEvent('island-toggle-history', {});
  });

  // 6. Mode & Sound controls
  const dndCheckbox = document.getElementById('dnd-checkbox');
  if (dndCheckbox) {
    dndCheckbox.addEventListener('change', () => {
      broadcastEvent('island-toggle-dnd', { enabled: dndCheckbox.checked });
    });
  }

  const muteCheckbox = document.getElementById('mute-checkbox');
  if (muteCheckbox) {
    muteCheckbox.addEventListener('change', () => {
      broadcastEvent('island-sound-mute', { muted: muteCheckbox.checked });
    });
  }

  // 7. Task 8: Local WebSocket Server controls & status
  setupWsControls();
}

function updateWsStatusUI(status) {
  const statusEl = document.getElementById('ws-server-status');
  const clientEl = document.getElementById('ws-client-status');

  if (statusEl) {
    if (status.error) {
      statusEl.textContent = status.error;
      statusEl.style.color = '#f44336';
    } else if (status.running) {
      statusEl.textContent = `Running on 127.0.0.1:${status.port}`;
      statusEl.style.color = '#4caf50';
    } else {
      statusEl.textContent = 'Stopped';
      statusEl.style.color = '#a1a1aa';
    }
  }

  if (clientEl) {
    if (status.client_connected) {
      clientEl.textContent = `Connected (${status.client_origin || 'local'})`;
      clientEl.style.color = '#4caf50';
    } else {
      clientEl.textContent = 'No client connected';
      clientEl.style.color = '#a1a1aa';
    }
  }
}

async function setupWsControls() {
  const tokenInput = document.getElementById('ws-token-input');
  const copyBtn = document.getElementById('btn-copy-token');

  let currentToken = '';

  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
    try {
      const res = await window.__TAURI__.core.invoke('get_ws_token');
      if (res && res.token) {
        currentToken = res.token;
        if (tokenInput) tokenInput.value = currentToken;
      }
    } catch (e) {
      console.warn('Failed to invoke get_ws_token', e);
    }

    try {
      const status = await window.__TAURI__.core.invoke('get_ws_status');
      if (status) updateWsStatusUI(status);
    } catch (e) {
      console.warn('Failed to invoke get_ws_status', e);
    }
  }

  if (window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.listen('ws-status-changed', (event) => {
      if (event.payload) updateWsStatusUI(event.payload);
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      if (!currentToken && tokenInput) {
        currentToken = tokenInput.value;
      }
      if (currentToken) {
        try {
          await navigator.clipboard.writeText(currentToken);
          const orig = copyBtn.textContent;
          copyBtn.textContent = 'Copied!';
          setTimeout(() => { copyBtn.textContent = orig; }, 1500);
        } catch (e) {
          console.error('Clipboard copy failed', e);
        }
      }
    });
  }
}

window.addEventListener('DOMContentLoaded', () => {
  setupControls();
});
