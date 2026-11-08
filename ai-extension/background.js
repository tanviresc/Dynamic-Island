import { CONFIG } from './config.js';

let ws = null;
let connectionStatus = 'no_token'; // 'connected' | 'disconnected' | 'no_token'
let currentBackoffMs = CONFIG.reconnect.initialDelayMs;
let reconnectTimer = null;
let pingInterval = null;

async function getToken() {
  const data = await chrome.storage.local.get(['token']);
  return data.token && data.token.trim().length > 0 ? data.token.trim() : null;
}

function updateStatus(newStatus) {
  if (connectionStatus !== newStatus) {
    connectionStatus = newStatus;
    // Broadcast status update to any listening views (e.g. popup)
    chrome.runtime.sendMessage({ kind: 'status_changed', status: connectionStatus }).catch(() => {});
  }
}

function clearTimers() {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  if (pingInterval) {
    clearInterval(pingInterval);
    pingInterval = null;
  }
}

async function connect() {
  clearTimers();

  const token = await getToken();
  if (!token) {
    updateStatus('no_token');
    if (ws) {
      ws.close();
      ws = null;
    }
    return;
  }

  // If already open or connecting, do not duplicate
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  try {
    ws = new WebSocket(CONFIG.wsUrl);
  } catch (err) {
    console.warn('[AI Island Extension] WebSocket creation failed:', err.message);
    scheduleReconnect();
    return;
  }

  ws.onopen = () => {
    // Send auth frame immediately upon opening
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ kind: 'auth', token }));
    }
  };

  ws.onmessage = (event) => {
    try {
      const data = JSON.parse(event.data);

      if (data.kind === 'auth_ok') {
        updateStatus('connected');
        currentBackoffMs = CONFIG.reconnect.initialDelayMs; // Reset backoff on success

        // Start ping keep-alive
        if (pingInterval) clearInterval(pingInterval);
        pingInterval = setInterval(() => {
          if (ws && ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ kind: 'ping' }));
          }
        }, CONFIG.pingIntervalMs);

        // Send initial web presence upon connection
        checkAndReportPresence();

      } else if (data.kind === 'auth_fail') {
        console.warn('[AI Island Extension] Authentication failed: invalid token.');
        updateStatus('disconnected');
        if (ws) ws.close();
      } else if (data.kind === 'pong') {
        // Heartbeat received
      } else if (data.kind === 'focus_tab') {
        handleFocusTab(data.site, data.tabId, data.windowId);
      }
    } catch (err) {
      console.warn('[AI Island Extension] Failed to parse incoming WebSocket message:', err);
    }
  };

  ws.onerror = (err) => {
    // Socket error will also trigger onclose
    console.warn('[AI Island Extension] WebSocket error encountered.');
  };

  ws.onclose = () => {
    ws = null;
    if (pingInterval) {
      clearInterval(pingInterval);
      pingInterval = null;
    }

    getToken().then((activeToken) => {
      if (activeToken) {
        updateStatus('disconnected');
        scheduleReconnect();
      } else {
        updateStatus('no_token');
      }
    });
  };
}

function scheduleReconnect() {
  if (reconnectTimer) clearTimeout(reconnectTimer);

  getToken().then((token) => {
    if (!token) {
      updateStatus('no_token');
      return;
    }

    console.log(`[AI Island Extension] Reconnecting in ${currentBackoffMs}ms...`);
    reconnectTimer = setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, currentBackoffMs);

    // Exponential backoff capped at maxDelayMs
    currentBackoffMs = Math.min(
      currentBackoffMs * CONFIG.reconnect.factor,
      CONFIG.reconnect.maxDelayMs
    );
  });
}

// Reconnect immediately when a new token is saved or modified
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.token) {
    currentBackoffMs = CONFIG.reconnect.initialDelayMs;
    if (ws) {
      ws.close();
      ws = null;
    }
    connect();
  }
});

// Runtime message handling: answers status requests, test triggers, and content script events
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || !message.kind) return;

  if (message.kind === 'get_status') {
    sendResponse({ status: connectionStatus });
    return true;
  }

  if (message.kind === 'reconnect_now') {
    currentBackoffMs = CONFIG.reconnect.initialDelayMs;
    if (ws) {
      ws.close();
      ws = null;
    }
    connect();
    sendResponse({ ok: true });
    return true;
  }

  if (message.kind === 'send_test') {
    if (connectionStatus === 'connected' && ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({
        kind: 'event',
        type: 'finished',
        site: 'claude',
        message: 'Test from extension'
      }));
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: `Not connected (status: ${connectionStatus})` });
    }
    return true;
  }

  // Relay for later tasks (content scripts)
  if (message.kind === 'site_event') {
    if (connectionStatus === 'connected' && ws && ws.readyState === WebSocket.OPEN) {
      const payload = {
        kind: 'event',
        type: message.type,
        site: message.site,
        taskKind: message.taskKind || 'question',
        message: message.message,
        tabId: sender.tab?.id,
        windowId: sender.tab?.windowId
      };
      ws.send(JSON.stringify(payload));
      sendResponse({ success: true });
    } else {
      sendResponse({ success: false, error: 'Not connected' });
    }
    return true;
  }
});

// Reconnect on startup or service worker wake-up
chrome.runtime.onStartup.addListener(() => {
  connect();
});

chrome.runtime.onInstalled.addListener(() => {
  connect();
});

// Task 12: Click-to-focus tab handler
async function handleFocusTab(site, tabId, windowId) {
  const siteUrlPatterns = {
    claude: '*://claude.ai/*',
    chatgpt: '*://*.chatgpt.com/*',
    gemini: '*://gemini.google.com/*'
  };

  let targetTab = null;
  if (typeof tabId === 'number') {
    try {
      targetTab = await chrome.tabs.get(tabId);
    } catch {
      targetTab = null;
    }
  }

  if (targetTab) {
    try {
      const winId = typeof windowId === 'number' ? windowId : targetTab.windowId;
      if (winId) {
        await chrome.windows.update(winId, { focused: true });
      }
      await chrome.tabs.update(tabId, { active: true });
      return;
    } catch (err) {
      console.warn('[AI Island Extension] Error focusing existing tab:', err.message);
    }
  }

  // Fallback: tab was closed, find another open tab of the same site
  const siteKey = (site || '').toLowerCase();
  const pattern = siteUrlPatterns[siteKey];
  if (pattern) {
    try {
      const tabs = await chrome.tabs.query({ url: pattern });
      if (tabs && tabs.length > 0) {
        const fallbackTab = tabs[0];
        if (fallbackTab.windowId) {
          await chrome.windows.update(fallbackTab.windowId, { focused: true });
        }
        await chrome.tabs.update(fallbackTab.id, { active: true });
        console.log(`[AI Island Extension] Focused fallback tab for ${siteKey}`);
        return;
      }
    } catch (err) {
      console.warn('[AI Island Extension] Error querying fallback tabs:', err.message);
    }
  }

  console.log(`[AI Island Extension] No open tab found for site: ${site}`);
}

// Protocol (section 12): Web presence reporting for context suppression
let lastReportedPresence = 'none';

async function checkAndReportPresence() {
  let site = 'none';
  try {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (tabs && tabs.length > 0 && tabs[0].url) {
      const url = tabs[0].url.toLowerCase();
      if (url.includes('claude.ai')) {
        site = 'claude';
      } else if (url.includes('chatgpt.com')) {
        site = 'chatgpt';
      } else if (url.includes('gemini.google.com')) {
        site = 'gemini';
      }
    }
  } catch (_) {
    site = 'none';
  }

  if (site !== lastReportedPresence) {
    lastReportedPresence = site;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ kind: 'presence', site: lastReportedPresence }));
    }
  }
}

// Event listeners for window/tab focus changes
chrome.tabs.onActivated.addListener(() => {
  checkAndReportPresence();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    if (lastReportedPresence !== 'none') {
      lastReportedPresence = 'none';
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ kind: 'presence', site: 'none' }));
      }
    }
  } else {
    checkAndReportPresence();
  }
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url || changeInfo.status === 'complete') {
    checkAndReportPresence();
  }
});

// Initial startup connection check
connect();

