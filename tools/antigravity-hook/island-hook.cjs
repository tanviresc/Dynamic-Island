#!/usr/bin/env node
/**
 * Antigravity Island Hook
 * Sends specific lifecycle events to the Dynamic Island WebSocket server (port 34567).
 * Zero-dependency, sub-50ms execution, never throws, outputs valid contract JSON on stdout and exits 0.
 */

const net = require('net');
const fs = require('fs');
const path = require('path');

function getConfig() {
  const candidates = [
    path.join(__dirname, '..', 'config.json'),
    path.join(__dirname, '..', '..', 'config.json'),
    path.join(process.cwd(), 'config.json'),
    path.join(process.cwd(), '..', 'config.json'),
    path.join(process.env.APPDATA || '', 'com.aiisland.app', 'config.json')
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        return JSON.parse(fs.readFileSync(c, 'utf8'));
      }
    } catch (_) {}
  }
  return null;
}

function getToken() {
  const candidates = [
    path.join(__dirname, '..', 'token.secret'),
    path.join(__dirname, 'token.secret'),
    path.join(process.cwd(), 'token.secret'),
    path.join(process.cwd(), '..', 'token.secret'),
    path.join(__dirname, '..', '..', 'token.secret'),
    path.join(process.env.APPDATA || '', 'com.aiisland.app', 'token.secret')
  ];
  for (const c of candidates) {
    try {
      if (fs.existsSync(c)) {
        return fs.readFileSync(c, 'utf8').trim();
      }
    } catch (_) {}
  }
  return null;
}

function buildFrame(obj) {
  const payloadBuf = Buffer.from(JSON.stringify(obj));
  const len = payloadBuf.length;
  let header;
  const mask = Buffer.from([0x23, 0x45, 0x67, 0x89]);
  if (len < 126) {
    header = Buffer.from([0x81, 0x80 | len]);
  } else {
    header = Buffer.alloc(4);
    header[0] = 0x81;
    header[1] = 0x80 | 126;
    header.writeUInt16BE(len, 2);
  }
  const masked = Buffer.alloc(len);
  for (let i = 0; i < len; i++) {
    masked[i] = payloadBuf[i] ^ mask[i % 4];
  }
  return Buffer.concat([header, mask, masked]);
}

function sendIslandEvent(type, message, taskId) {
  return new Promise((resolve) => {
    let resolved = false;
    const finish = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    const timer = setTimeout(() => {
      finish();
    }, 450);

    try {
      const token = getToken();
      const client = net.createConnection({ host: '127.0.0.1', port: 34567 }, () => {
        const key = Buffer.from(Math.random().toString()).toString('base64');
        const req = [
          'GET /ws HTTP/1.1',
          'Host: 127.0.0.1:34567',
          'Upgrade: websocket',
          'Connection: Upgrade',
          `Sec-WebSocket-Key: ${key}`,
          'Sec-WebSocket-Version: 13',
          '\r\n'
        ].join('\r\n');
        client.write(req);
      });

      let handshaken = false;
      let authenticated = false;

      client.on('data', (data) => {
        const str = data.toString('utf8');
        if (!handshaken) {
          if (str.includes('101 Switching Protocols')) {
            handshaken = true;
            client.write(buildFrame({ kind: 'auth', token: token || '' }));
          }
        } else if (!authenticated) {
          if (str.includes('auth_ok')) {
            authenticated = true;
            client.write(buildFrame({
              kind: 'event',
              type: type,
              site: 'antigravity',
              source: 'ide',
              message: message || `Antigravity: ${type}`,
              taskId: taskId || undefined
            }));
            setTimeout(() => {
              try { client.end(); } catch (_) {}
              clearTimeout(timer);
              finish();
            }, 30);
          } else if (str.includes('auth_fail')) {
            try { client.end(); } catch (_) {}
            clearTimeout(timer);
            finish();
          }
        }
      });

      client.on('error', () => {
        clearTimeout(timer);
        finish();
      });

      client.on('close', () => {
        clearTimeout(timer);
        finish();
      });
    } catch (_) {
      clearTimeout(timer);
      finish();
    }
  });
}

function readStdin(timeoutMs = 60) {
  return new Promise((resolve) => {
    let data = '';
    const timer = setTimeout(() => {
      resolve(data);
    }, timeoutMs);

    process.stdin.setEncoding('utf8');
    process.stdin.on('data', chunk => {
      data += chunk;
    });
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(data);
    });
    process.stdin.on('error', () => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

function truncateWithEllipsis(str, maxLen = 120) {
  if (!str) return '';
  const single = str.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (single.length <= maxLen) return single;
  return single.slice(0, maxLen - 3).trimEnd() + '...';
}

function extractTaskContext(rawPrompt, fallbackTitle = '') {
  if (!rawPrompt || typeof rawPrompt !== 'string' || !rawPrompt.trim()) {
    return fallbackTitle || 'Task';
  }

  // 1. Clean raw prompt: remove HTML/XML tags, code blocks, URLs
  let text = rawPrompt
    .replace(/<[^>]+>/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/`[^`]+`/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return fallbackTitle || 'Task';
  }

  // 2. Safe Natural Action Extraction: NO guessed categories or keyword rules
  let cleaned = text
    .replace(/^(?:please|can you|could you|would you|will you|help me to|help me|i want you to|i need you to|i'd like you to|tell me|give me|show me|how to|what is|write a|generate a|create a)\s+/i, '')
    .replace(/^(?:hi|hello|hey|greetings|antigravity|claude|chatgpt|gemini)[,\s:]+/i, '')
    .trim();

  // Take first clause or sentence
  cleaned = cleaned.split(/[.?!\n;]/)[0].trim();

  if (cleaned.length >= 3) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
    if (cleaned.length > 35) {
      cleaned = cleaned.slice(0, 32).trimEnd() + '...';
    }
    return cleaned;
  }

  return fallbackTitle || 'Task';
}

const EVIDENCE_FILE = path.join(process.env.APPDATA || '', 'com.aiisland.app', 'antigravity-evidence.json');

function loadEvidenceStore() {
  try {
    if (fs.existsSync(EVIDENCE_FILE)) {
      return JSON.parse(fs.readFileSync(EVIDENCE_FILE, 'utf8'));
    }
  } catch (_) {}
  return {};
}

function saveEvidenceStore(store) {
  try {
    const dir = path.dirname(EVIDENCE_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    const keys = Object.keys(store);
    if (keys.length > 50) {
      keys.slice(0, keys.length - 50).forEach(k => delete store[k]);
    }
    fs.writeFileSync(EVIDENCE_FILE, JSON.stringify(store), 'utf8');
  } catch (_) {}
}

function getTaskEvidence(store, taskId, folder) {
  const tid = taskId || 'default';
  if (!store[tid]) {
    store[tid] = {
      edited: 0,
      created: 0,
      commands: 0,
      searches: 0,
      images: 0,
      approvals: 0,
      steps: 0,
      taskTitle: folder || 'Task'
    };
  }
  return store[tid];
}

function formatFinishedMessage(taskTitle, task, maxLen = 120) {
  const counts = [];
  if (task.edited > 0) counts.push(`${task.edited} edited`);
  if (task.created > 0) counts.push(`${task.created} created`);
  if (task.commands > 0) counts.push(`${task.commands} ${task.commands === 1 ? 'command' : 'commands'}`);
  if (task.searches > 0) counts.push(`${task.searches} ${task.searches === 1 ? 'search' : 'searches'}`);
  if (task.images > 0) counts.push(`${task.images} ${task.images === 1 ? 'image generated' : 'images generated'}`);

  const countsStr = counts.length > 0 ? ` · ${counts.join(' · ')}` : '';
  const title = (taskTitle || task.taskTitle || '').trim();

  let msg = '';
  if (title && title !== 'Task') {
    msg = `Done: ${title}${countsStr}`;
  } else if (counts.length > 0) {
    msg = `Task finished${countsStr}`;
  } else {
    msg = 'Task finished';
  }

  if (msg.length > maxLen) {
    const availableForTitle = maxLen - `Done: ...${countsStr}`.length;
    if (availableForTitle > 5) {
      const truncatedTitle = title.slice(0, availableForTitle).trimEnd();
      msg = `Done: ${truncatedTitle}...${countsStr}`;
    } else {
      msg = truncateWithEllipsis(msg, maxLen);
    }
  }
  return msg;
}

function formatStoppedMessage(taskTitle, task, maxLen = 120) {
  const title = (taskTitle || task.taskTitle || '').trim();
  const stepStr = task.steps > 0 ? ` (after ${task.steps} ${task.steps === 1 ? 'step' : 'steps'})` : '';

  let msg = '';
  if (title && title !== 'Task') {
    msg = `Stopped: ${title}${stepStr}`;
  } else {
    msg = `Task stopped${stepStr}`;
  }
  return truncateWithEllipsis(msg, maxLen);
}

function formatApprovalMessage(toolName) {
  const tn = String(toolName || '').toLowerCase();
  if (tn === 'run_command') return 'Needs approval: run a command';
  if (tn === 'edit_file') return 'Needs approval: edit a file';
  if (tn === 'write_file') return 'Needs approval: create a file';
  if (tn === 'ask_question' || tn.startsWith('ask_')) return 'Needs approval: answer question';
  if (tn.includes('image')) return 'Needs approval: generate an image';
  return 'Needs approval';
}

function getProjectFolder(payload) {
  if (Array.isArray(payload.workspacePaths) && payload.workspacePaths.length > 0) {
    const raw = payload.workspacePaths[0];
    if (typeof raw === 'string') {
      const norm = raw.replace(/\\/g, '/').replace(/\/+$/, '');
      const parts = norm.split('/');
      const last = parts[parts.length - 1];
      if (last) return last;
    }
  }
  return '';
}

function formatQuestionText(toolCall) {
  if (!toolCall) return '';
  const args = toolCall.args || toolCall.arguments || {};
  if (Array.isArray(args.questions) && args.questions.length > 0) {
    const q = args.questions[0];
    const text = typeof q === 'string' ? q : (q.question || '');
    if (text) {
      let clean = text.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
      if (clean.length > 45) {
        clean = clean.slice(0, 42).trimEnd() + '...';
      }
      return clean;
    }
  }
  if (typeof args.question === 'string' && args.question.trim().length > 0) {
    let clean = args.question.replace(/[\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (clean.length > 45) {
      clean = clean.slice(0, 42).trimEnd() + '...';
    }
    return clean;
  }
  if (toolCall.name === 'run_command' && args.CommandLine) {
    let cmd = String(args.CommandLine).replace(/[\r\n\t]+/g, ' ').trim();
    if (cmd.length > 35) {
      cmd = cmd.slice(0, 32).trimEnd() + '...';
    }
    return `Approve: ${cmd}`;
  }
  return '';
}

function logTraceRecord(hookName, hookPayload, taskId) {
  try {
    const appCfg = getConfig();
    if (!appCfg?.antigravityTrace) return;

    const traceDir = path.join(process.env.APPDATA || '', 'com.aiisland.app');
    if (!fs.existsSync(traceDir)) {
      fs.mkdirSync(traceDir, { recursive: true });
    }
    const traceFile = path.join(traceDir, 'antigravity-trace.jsonl');

    // 2 MB max size with single-file rotation
    if (fs.existsSync(traceFile)) {
      try {
        const stats = fs.statSync(traceFile);
        if (stats.size > 2 * 1024 * 1024) {
          const oldFile = path.join(traceDir, 'antigravity-trace.jsonl.old');
          try { if (fs.existsSync(oldFile)) fs.unlinkSync(oldFile); } catch (_) {}
          fs.renameSync(traceFile, oldFile);
        }
      } catch (_) {}
    }

    const toolCall = hookPayload?.toolCall || {};
    const toolName = toolCall.name || hookPayload?.tool || hookPayload?.toolName || null;
    const fieldNames = Object.keys(hookPayload || {});

    const record = {
      timestamp: Date.now(),
      event: hookName || 'unknown',
      taskId: taskId || null,
      toolName: toolName ? String(toolName) : null,
      fields: fieldNames
    };

    fs.appendFileSync(traceFile, JSON.stringify(record) + '\n', 'utf8');
  } catch (_) {}
}

async function main() {
  let hookName = process.argv[2] || '';
  let hookPayload = {};

  try {
    const rawStdin = await readStdin(60);
    if (rawStdin && rawStdin.trim().length > 0) {
      try {
        hookPayload = JSON.parse(rawStdin);
      } catch (_) {}
    }

    if (!hookName) {
      hookName = hookPayload.hook || hookPayload.event || hookPayload.eventName || '';
    }

    // taskId: validated string up to 64 chars from conversationId
    let taskId = undefined;
    if (hookPayload.conversationId && typeof hookPayload.conversationId === 'string') {
      taskId = hookPayload.conversationId.trim().slice(0, 64);
    }

    // Stage 1 Trace Logging (zero prompts, zero code, zero arguments)
    logTraceRecord(hookName, hookPayload, taskId);

    const appCfg = getConfig();
    const detailMode = appCfg?.antigravityDetail || 'specific';

    const folder = getProjectFolder(hookPayload);
    const store = loadEvidenceStore();
    const task = getTaskEvidence(store, taskId, folder);

    if (hookPayload.lastUserInput) {
      task.taskTitle = extractTaskContext(hookPayload.lastUserInput, folder);
    }

    let shouldSend = false;
    let type = 'finished';
    let msg = 'Antigravity: finished';

    const h = (hookName || '').toLowerCase();

    if (h.includes('preinvocation') || h === 'working' || h === 'start') {
      shouldSend = true;
      type = 'working';
      // Reset counters for new turn
      task.edited = 0;
      task.created = 0;
      task.commands = 0;
      task.searches = 0;
      task.images = 0;
      task.approvals = 0;
      task.steps = 0;
      msg = task.taskTitle ? `Working: ${task.taskTitle}` : 'Working: Task';
    } else if (h.includes('pretooluse')) {
      const toolCall = hookPayload.toolCall || {};
      const toolName = (toolCall.name || hookPayload.tool || hookPayload.toolName || '').toLowerCase();
      const args = toolCall.args || toolCall.arguments || {};
      const isQuestion = toolName === 'ask_question' || toolName.startsWith('ask_') || toolName === 'ask' || toolName.includes('question');
      const isApprovalCommand = (toolName === 'run_command' && args.BypassSandbox === true);
      const isConfirmationTool = toolName.includes('confirm') || toolName.includes('approval') || toolName.includes('permission');

      task.steps++;

      // Real Evidence Counters based strictly on observed tools
      if (toolName === 'edit_file') {
        task.edited++;
      } else if (toolName === 'write_file') {
        const filePath = (args.Path || args.path || '').toLowerCase();
        if (/\.(?:png|jpe?g|webp|gif)$/i.test(filePath)) {
          task.images++;
        } else {
          task.created++;
        }
      } else if (toolName === 'run_command') {
        task.commands++;
        if (args.BypassSandbox === true) {
          task.approvals++;
        }
      } else if (toolName.includes('search') || toolName === 'search_web') {
        task.searches++;
      } else if (
        toolName.includes('image_generator') ||
        toolName.includes('image-generator') ||
        toolName.includes('generate_image')
      ) {
        task.images++;
      }

      if (isQuestion || isApprovalCommand || isConfirmationTool) {
        shouldSend = true;
        type = 'needs_input';
        task.approvals++;
        msg = formatApprovalMessage(toolName);
      } else {
        // Standard automated tool step: refreshes activity, NEVER emits finished
        shouldSend = true;
        type = 'step';
        msg = task.taskTitle ? `Working: ${task.taskTitle}` : 'Working';
      }
    } else if (h.includes('posttooluse')) {
      // Tool finished executing, refresh activity
      shouldSend = true;
      type = 'step';
      msg = task.taskTitle ? `Working: ${task.taskTitle}` : 'Working';
    } else if (h.includes('postinvocation')) {
      // Intermediate step finished, refresh activity
      shouldSend = true;
      type = 'step';
      msg = task.taskTitle ? `Working: ${task.taskTitle}` : 'Working';
    } else if (h.includes('stop') || h.includes('cancel')) {
      shouldSend = true;
      const termReason = (hookPayload.terminationReason || '').toUpperCase();
      const isError = termReason.includes('ERROR') || Boolean(hookPayload.error);
      const isCancel = termReason.includes('CANCEL');

      if (isError || isCancel) {
        type = 'stopped';
        msg = formatStoppedMessage(task.taskTitle, task);
      } else {
        type = 'finished';
        msg = formatFinishedMessage(task.taskTitle, task);
      }
    }

    saveEvidenceStore(store);

    if (shouldSend) {
      // Strict 120-character single-line limit with ellipsis
      msg = truncateWithEllipsis(msg, 120);
      await sendIslandEvent(type, msg, taskId);
    }
  } catch (_) {
    // Fail-safe: zero throwing
  } finally {
    // Antigravity contract compliance
    const h = (hookName || '').toLowerCase();
    if (h.includes('pretooluse')) {
      process.stdout.write(JSON.stringify({ decision: 'allow' }));
    } else if (h.includes('posttooluse')) {
      process.stdout.write(JSON.stringify({}));
    } else if (h.includes('preinvocation') || h.includes('postinvocation')) {
      process.stdout.write(JSON.stringify({ injectSteps: [] }));
    } else {
      process.stdout.write(JSON.stringify({}));
    }
    process.exit(0);
  }
}

main();
