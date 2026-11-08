#!/usr/bin/env node
import { WebSocket } from 'ws';

const args = process.argv.slice(2);

if (args.length < 4) {
  console.log(`Usage: node tools/ws-test.mjs <token> <type> <site> "<message>" [--origin <url>] [--port <port>]`);
  console.log(`Examples:`);
  console.log(`  node tools/ws-test.mjs MY_SECRET finished claude "Document generated"`);
  console.log(`  node tools/ws-test.mjs MY_SECRET working chatgpt "Thinking..." --origin chrome-extension://abcdef`);
  console.log(`  node tools/ws-test.mjs MY_SECRET finished gemini "Done" --origin https://example.com`);
  process.exit(1);
}

const token = args[0];
const type = args[1];
const site = args[2];
const message = args[3];

let origin = undefined;
let port = 34567;
let taskId = undefined;

for (let i = 4; i < args.length; i++) {
  if (args[i] === '--origin' && args[i + 1]) {
    origin = args[i + 1];
    i++;
  } else if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--task-id' && args[i + 1]) {
    taskId = args[i + 1];
    i++;
  }
}

const wsUrl = `ws://127.0.0.1:${port}`;
console.log(`[WS TEST] Connecting to ${wsUrl}${origin ? ` with Origin: ${origin}` : ' (no Origin header)'}...`);

const wsOptions = {};
if (origin) {
  wsOptions.origin = origin;
  wsOptions.headers = { Origin: origin };
}

const ws = new WebSocket(wsUrl, wsOptions);

let authResolved = false;

const timeout = setTimeout(() => {
  console.error('[WS TEST ERROR] Handshake timed out after 5s');
  ws.terminate();
  process.exit(1);
}, 5000);

ws.on('open', () => {
  console.log('[WS TEST] WebSocket connected. Sending auth...');
  ws.send(JSON.stringify({ kind: 'auth', token }));
});

ws.on('message', (data) => {
  try {
    const parsed = JSON.parse(data.toString());
    console.log('[WS TEST] Received:', parsed);

    if (parsed.kind === 'auth_ok') {
      authResolved = true;
      console.log('[WS TEST] Auth OK! Sending notification event...');
      ws.send(JSON.stringify({
        kind: 'event',
        type,
        site,
        message,
        taskId
      }));

      // Allow event frame to flush, then close gracefully
      setTimeout(() => {
        clearTimeout(timeout);
        console.log('[WS TEST] Notification event dispatched successfully.');
        ws.close();
        process.exit(0);
      }, 350);
    } else if (parsed.kind === 'auth_fail') {
      clearTimeout(timeout);
      console.error('[WS TEST ERROR] Authentication failed (token rejected by server).');
      ws.close();
      process.exit(1);
    }
  } catch (err) {
    console.error('[WS TEST ERROR] Failed to parse message:', err);
  }
});

ws.on('unexpected-response', (req, res) => {
  clearTimeout(timeout);
  console.error(`[WS TEST ERROR] Server rejected upgrade with HTTP status ${res.statusCode} (${res.statusMessage}).`);
  process.exit(1);
});

ws.on('error', (err) => {
  clearTimeout(timeout);
  console.error('[WS TEST ERROR] Socket error:', err.message);
  process.exit(1);
});

ws.on('close', (code, reason) => {
  clearTimeout(timeout);
  if (!authResolved) {
    console.error(`[WS TEST] Connection closed before auth resolution (code: ${code}, reason: ${reason.toString() || 'none'})`);
    process.exit(1);
  }
});

