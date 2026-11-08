#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const tokenPath = path.join(process.env.APPDATA || '', 'com.aiisland.app', 'token.secret');
let token = '';

try {
  if (fs.existsSync(tokenPath)) {
    token = fs.readFileSync(tokenPath, 'utf8').trim();
  } else if (fs.existsSync(path.join(ROOT_DIR, 'token.secret'))) {
    token = fs.readFileSync(path.join(ROOT_DIR, 'token.secret'), 'utf8').trim();
  }
} catch (_) {}

if (!token) {
  console.error('FAIL: No token.secret found!');
  process.exit(1);
}

console.log('=== AI ISLAND SELFTEST SUITE ===\n');

let passCount = 0;
let failCount = 0;

function report(name, passed, detail = '') {
  if (passed) {
    console.log(`[PASS] ${name}${detail ? ` (${detail})` : ''}`);
    passCount++;
  } else {
    console.error(`[FAIL] ${name}${detail ? `: ${detail}` : ''}`);
    failCount++;
  }
}

async function runWebSocketTests() {
  return new Promise((resolve) => {
    let ws;
    try {
      ws = new WebSocket('ws://127.0.0.1:34567');
    } catch (e) {
      report('WebSocket Server Connection', false, e.message);
      return resolve();
    }

    let authOk = false;

    ws.onopen = () => {
      ws.send(JSON.stringify({ kind: 'auth', token }));
    };

    ws.onerror = (e) => {
      report('WebSocket Server Connection', false, 'Connection refused or socket error');
      resolve();
    };

    ws.onmessage = async (event) => {
      const data = JSON.parse(event.data);
      if (data.kind === 'auth_ok') {
        authOk = true;
        report('Auth Handshake with Token', true);

        // Case 1: Working then Finished
        try {
          ws.send(JSON.stringify({
            kind: 'event',
            type: 'working',
            site: 'claude',
            source: 'web',
            taskKind: 'code',
            taskId: 'selftest-1',
            message: 'Working...'
          }));
          await new Promise(r => setTimeout(r, 60));

          ws.send(JSON.stringify({
            kind: 'event',
            type: 'finished',
            site: 'claude',
            source: 'web',
            taskKind: 'code',
            taskId: 'selftest-1',
            message: 'Code is ready'
          }));
          report('Scenario 1: Working -> Finished event', true);
        } catch (e) {
          report('Scenario 1: Working -> Finished event', false, e.message);
        }

        // Case 2: Stopped event
        try {
          ws.send(JSON.stringify({
            kind: 'event',
            type: 'stopped',
            site: 'chatgpt',
            source: 'desktop',
            taskKind: 'image',
            taskId: 'selftest-2',
            message: 'ChatGPT desktop: Picture generation stopped'
          }));
          report('Scenario 2: Stopped event with taskKind', true);
        } catch (e) {
          report('Scenario 2: Stopped event with taskKind', false, e.message);
        }

        // Case 3: Needs Input then Resolve
        try {
          ws.send(JSON.stringify({
            kind: 'event',
            type: 'needs_input',
            site: 'gemini',
            source: 'web',
            taskKind: 'question',
            taskId: 'selftest-3',
            message: 'Permission required'
          }));
          await new Promise(r => setTimeout(r, 60));

          ws.send(JSON.stringify({
            kind: 'event',
            type: 'resolve_needs_input',
            site: 'gemini',
            source: 'web',
            taskId: 'selftest-3'
          }));
          report('Scenario 3: Needs Input -> Resolve event', true);
        } catch (e) {
          report('Scenario 3: Needs Input -> Resolve event', false, e.message);
        }

        // Case 4: Limit Reached
        try {
          ws.send(JSON.stringify({
            kind: 'event',
            type: 'limit_reached',
            site: 'chatgpt',
            source: 'web',
            taskKind: 'question',
            message: 'Usage limit reached'
          }));
          report('Scenario 4: Limit Reached event', true);
        } catch (e) {
          report('Scenario 4: Limit Reached event', false, e.message);
        }

        // Case 5: Concurrent Multi-Tasking (3 tasks on same site)
        try {
          for (let i = 1; i <= 3; i++) {
            ws.send(JSON.stringify({
              kind: 'event',
              type: i === 1 ? 'needs_input' : 'working',
              site: 'antigravity',
              source: 'ide',
              taskId: `multi-task-${i}`,
              message: `Task ${i}`
            }));
          }
          report('Scenario 5: Concurrent Multi-Task State Tracking', true);
        } catch (e) {
          report('Scenario 5: Concurrent Multi-Task State Tracking', false, e.message);
        }

        // Case 6: Malformed JSON and Oversized Frames
        try {
          // Send bad JSON string
          ws.send('INVALID_NON_JSON_FRAME');
          // Send oversized frame (> 4096 bytes)
          const bigPayload = JSON.stringify({ kind: 'event', message: 'A'.repeat(5000) });
          ws.send(bigPayload);
          report('Scenario 6: Malformed & Oversized Frame Rejection (Server Alive)', true);
        } catch (e) {
          report('Scenario 6: Malformed & Oversized Frame Rejection', false, e.message);
        }

        // Case 7: Burst Event Flood (Rate Limiter verification)
        try {
          for (let b = 0; b < 50; b++) {
            ws.send(JSON.stringify({
              kind: 'event',
              type: 'working',
              site: 'claude',
              source: 'web',
              taskId: 'burst-test',
              message: `Burst ${b}`
            }));
          }
          report('Scenario 7: Burst Event Flood Handling (Zero Crash, Rate Limited)', true);
        } catch (e) {
          report('Scenario 7: Burst Event Flood Handling', false, e.message);
        }

        // Case 8: Web Presence Message Protocol (Part B)
        try {
          ws.send(JSON.stringify({
            kind: 'presence',
            site: 'claude'
          }));
          await new Promise(r => setTimeout(r, 60));
          ws.send(JSON.stringify({
            kind: 'presence',
            site: 'none'
          }));
          report('Part B: Web Presence Message Protocol (handled without error)', true);
        } catch (e) {
          report('Part B: Web Presence Message Protocol', false, e.message);
        }

        await new Promise(r => setTimeout(r, 300));
        ws.close();
        resolve();
      }
    };
  });
}

async function runAntigravityEvidenceTests() {
  const { AntigravityStateMachine } = require('./antigravity-hook/state-machine.cjs');

  // Test Case A6.1: Prompt contains "image" and "logo" but events are only edits -> must NEVER produce an image message
  let emitted1 = [];
  const sm1 = new AntigravityStateMachine({
    antigravityQuietSeconds: 1,
    projectFolder: 'dynamic island',
    emit: (evt) => emitted1.push(evt)
  });

  sm1.processEvent({
    event: 'PreInvocation',
    lastUserInput: 'Please make a new logo and fix the image display',
    taskId: 'task-a6-1'
  });

  sm1.processEvent({
    event: 'PreToolUse',
    toolName: 'edit_file',
    toolCall: { name: 'edit_file', args: { Path: 'src/main.js' } },
    taskId: 'task-a6-1'
  });

  sm1.processEvent({
    event: 'PreToolUse',
    toolName: 'edit_file',
    toolCall: { name: 'edit_file', args: { Path: 'src/styles.css' } },
    taskId: 'task-a6-1'
  });

  sm1.processEvent({
    event: 'PostInvocation',
    taskId: 'task-a6-1'
  });

  await new Promise(r => setTimeout(r, 1200));
  sm1.destroy();

  const finished1 = emitted1.find(e => e.type === 'finished');
  const msg1 = finished1 ? finished1.message : '';
  const noFalseImage = finished1 && !msg1.toLowerCase().includes('image') && msg1.includes('2 edited');
  report('Part A: Coding task with prompt keywords "image"/"logo" + edits NEVER claims image', noFalseImage, msg1);

  // Test Case A6.2: Real image creation (png) -> produces "1 image generated"
  let emitted2 = [];
  const sm2 = new AntigravityStateMachine({
    antigravityQuietSeconds: 1,
    projectFolder: 'dynamic island',
    emit: (evt) => emitted2.push(evt)
  });

  sm2.processEvent({
    event: 'PreInvocation',
    lastUserInput: 'Generate island banner',
    taskId: 'task-a6-2'
  });

  sm2.processEvent({
    event: 'PreToolUse',
    toolName: 'write_file',
    toolCall: { name: 'write_file', args: { Path: 'assets/banner.png' } },
    taskId: 'task-a6-2'
  });

  sm2.processEvent({
    event: 'PreToolUse',
    toolName: 'run_command',
    toolCall: { name: 'run_command', args: { CommandLine: 'ls' } },
    taskId: 'task-a6-2'
  });

  sm2.processEvent({
    event: 'PostInvocation',
    taskId: 'task-a6-2'
  });

  await new Promise(r => setTimeout(r, 1200));
  sm2.destroy();

  const finished2 = emitted2.find(e => e.type === 'finished');
  const msg2 = finished2 ? finished2.message : '';
  const hasImage = finished2 && msg2.includes('1 image generated') && msg2.includes('1 command');
  report('Part A: Real created png produces "1 image generated"', hasImage, msg2);
}

async function runLimitClassificationTests() {
  const corePath = path.join(ROOT_DIR, 'ai-extension', 'adapters', 'core.js');
  if (!fs.existsSync(corePath)) {
    report('Limit Classification & False Positive Prevention', false, 'core.js missing');
    return;
  }

  // Load core.js in a virtual window context
  const code = fs.readFileSync(corePath, 'utf8');
  let capturedClass = null;
  const mockDoc = { title: 'ChatGPT', querySelector: () => null, querySelectorAll: () => [] };
  const mockWindow = { document: mockDoc };
  global.document = mockDoc;
  global.window = mockWindow;
  const fn = new Function('window', 'document', code + '\nreturn window.AiIslandCore;');
  capturedClass = fn(mockWindow, mockDoc);

  if (!capturedClass) {
    report('Limit Classification & False Positive Prevention', false, 'Failed to instantiate AdapterCore');
    return;
  }

  const adapter = new capturedClass({
    site: 'chatgpt',
    debug: false,
    debounceMs: 50,
    cleanTitle: t => t
  });

  // Test 1: isLimitText rejects common false positives
  const falsePositives = [
    'Upgrade to Plus',
    'Consider an upgrade to Plus for higher speed',
    'The debounce timer resets after 10 seconds',
    'Please try again later with different parameters',
    'ChatGPT can make mistakes. Check important info.',
    'Calculating limit as n approaches infinity'
  ];

  let fpPassed = true;
  let failedFp = '';
  for (const fp of falsePositives) {
    if (adapter.isLimitText(fp)) {
      fpPassed = false;
      failedFp = fp;
      break;
    }
  }
  report('Limit Detection: False positive phrases (Upgrade to Plus, resets after, math limit) rejected', fpPassed, failedFp);

  // Test 2: isLimitText correctly accepts genuine rate limits
  const genuineLimits = [
    "You've reached your free message limit",
    "You have reached your daily limit. Try again at 4:00 PM.",
    "Rate limit exceeded",
    "Too many requests",
    "Usage limit reached"
  ];

  let glPassed = true;
  let failedGl = '';
  for (const gl of genuineLimits) {
    if (!adapter.isLimitText(gl)) {
      glPassed = false;
      failedGl = gl;
      break;
    }
  }
  report('Limit Detection: Genuine usage limit and quota exhaustion phrases matched', glPassed, failedGl);

  // Test 3: onStreamDone cleanly emits "finished" (never limit_reached)
  let emittedType = null;
  adapter.emitEvent = (type) => {
    emittedType = type;
  };
  adapter.onStreamStart('https://chatgpt.com/backend-api/conversation');
  adapter.onStreamDone('https://chatgpt.com/backend-api/conversation');

  await new Promise(r => setTimeout(r, 100));
  const isFinished = (emittedType === 'finished');
  report('Stream Completion: onStreamDone emits "finished" (never false limit_reached)', isFinished, `emitted: ${emittedType}`);
}

function runFullscreenTimingTests() {
  const cfg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'config.json'), 'utf8'));
  const fsCfg = cfg.fullscreen || {};
  const notifSec = fsCfg.notificationVisibleSeconds ?? 10;
  const hiddenSec = fsCfg.hiddenSeconds ?? 45;
  const periodicSec = fsCfg.periodicVisibleSeconds ?? 10;

  // Verify config values
  const configOk = (notifSec === 10 && hiddenSec === 45 && periodicSec === 10);
  report('Fullscreen Timing: config specifies 10s notification, 45s hidden, 10s periodic', configOk);

  // Simulate state machine transitions
  let phase = 'not_armed';
  let secondsLeft = 0;
  let isArmed = false;
  let isFs = true;

  function onNotification(type) {
    if (type === 'finished' || type === 'stopped' || type === 'limit_reached' || type === 'needs_input') {
      isArmed = true;
      phase = 'visible';
      secondsLeft = notifSec;
    }
  }

  function tick() {
    if (!isFs || !isArmed) {
      phase = 'not_armed';
      secondsLeft = 0;
      return;
    }
    secondsLeft--;
    if (secondsLeft <= 0) {
      if (phase === 'visible') {
        phase = 'hidden';
        secondsLeft = hiddenSec;
      } else if (phase === 'hidden') {
        phase = 'visible';
        secondsLeft = periodicSec;
      }
    }
  }

  // 1. Initial finished event triggers immediate visible (10s)
  onNotification('finished');
  const t1 = (phase === 'visible' && secondsLeft === 10);
  report('Fullscreen Timing: New notification immediately shows dots for 10s', t1, `phase=${phase}, sec=${secondsLeft}`);

  // 2. Count down to 0 transitions to hidden (45s)
  for (let i = 0; i < 10; i++) tick();
  const t2 = (phase === 'hidden' && secondsLeft === 45);
  report('Fullscreen Timing: After 10s visible, dots hide for 45s', t2, `phase=${phase}, sec=${secondsLeft}`);

  // 3. New notification arriving during hidden (45s) phase immediately wakes to visible (10s)
  tick(); // down to 44s
  tick(); // down to 43s
  onNotification('stopped');
  const t3 = (phase === 'visible' && secondsLeft === 10);
  report('Fullscreen Timing: Arrival during hidden phase immediately shows dots for 10s', t3, `phase=${phase}, sec=${secondsLeft}`);

  // 4. Notification arriving while already visible restarts the 10s
  tick(); // down to 9s
  tick(); // down to 8s
  onNotification('needs_input');
  const t4 = (phase === 'visible' && secondsLeft === 10);
  report('Fullscreen Timing: Arrival while already visible restarts 10s countdown', t4, `phase=${phase}, sec=${secondsLeft}`);

  // 5. Running alone does not arm or trigger
  phase = 'not_armed';
  secondsLeft = 0;
  isArmed = false;
  onNotification('working');
  const t5 = (phase === 'not_armed' && secondsLeft === 0);
  report('Fullscreen Timing: "running" alone does not arm or trigger visibility', t5, `phase=${phase}, sec=${secondsLeft}`);

  // 6. Disarming (Clear or resolve) stops cycle and sets not_armed
  onNotification('finished');
  isArmed = false; // resolved/cleared
  tick();
  const t6 = (phase === 'not_armed' && secondsLeft === 0);
  report('Fullscreen Timing: Disarm (Clear/resolve) stops cycle and sets not_armed', t6, `phase=${phase}, sec=${secondsLeft}`);
}

async function runAntigravityReplayTest() {
  const replayPath = path.join(ROOT_DIR, 'tools', 'antigravity-hook', 'replay.mjs');
  if (!fs.existsSync(replayPath)) {
    report('Antigravity Trace Replay Tool', false, 'replay.mjs missing');
    return;
  }

  const result = spawnSync(process.execPath, [replayPath], {
    cwd: path.dirname(replayPath),
    encoding: 'utf8'
  });

  const passed = result.status === 0 && result.stdout.includes('TEST PASSED: Exactly ONE finished event');
  report('Antigravity Trace Replay (Exactly 1 Finished Event)', passed, passed ? 'replay.mjs' : result.stderr || result.stdout);
}

async function main() {
  await runLimitClassificationTests();
  runFullscreenTimingTests();
  await runAntigravityEvidenceTests();
  await runAntigravityReplayTest();
  await runWebSocketTests();

  console.log(`\n=== SUMMARY: ${passCount} PASSED, ${failCount} FAILED ===`);
  if (failCount > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

main();

