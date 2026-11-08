#!/usr/bin/env node
/**
 * Installer for Antigravity Island Hook.
 * Copies island-hook.cjs into .agents/ and writes clean, relative hooks.json without spaces or quotes.
 */

const fs = require('fs');
const path = require('path');

const targetDir = path.resolve(process.cwd(), '.agents');
if (!fs.existsSync(targetDir)) {
  fs.mkdirSync(targetDir, { recursive: true });
}

// Copy island-hook.cjs directly into .agents/
const srcHook = path.resolve(__dirname, 'island-hook.cjs');
const dstHook = path.join(targetDir, 'island-hook.cjs');
fs.copyFileSync(srcHook, dstHook);

// Clear/initialize the trace file for Stage 1 trace logging
try {
  const traceDir = path.join(process.env.APPDATA || '', 'com.aiisland.app');
  if (!fs.existsSync(traceDir)) {
    fs.mkdirSync(traceDir, { recursive: true });
  }
  const traceFile = path.join(traceDir, 'antigravity-trace.jsonl');
  fs.writeFileSync(traceFile, '', 'utf8');
  console.log(`[AI Island] Cleared/initialized trace file: ${traceFile}`);
} catch (e) {
  console.error('[AI Island] Failed to initialize trace file:', e.message);
}

const hooksFile = path.join(targetDir, 'hooks.json');
const hooksConfig = {
  "island-notification": {
    "enabled": true,
    "PreInvocation": [
      {
        "type": "command",
        "command": "node island-hook.cjs PreInvocation",
        "timeout": 5
      }
    ],
    "PostInvocation": [
      {
        "type": "command",
        "command": "node island-hook.cjs PostInvocation",
        "timeout": 5
      }
    ],
    "PreToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node island-hook.cjs PreToolUse",
            "timeout": 5
          }
        ]
      }
    ],
    "PostToolUse": [
      {
        "matcher": "*",
        "hooks": [
          {
            "type": "command",
            "command": "node island-hook.cjs PostToolUse",
            "timeout": 5
          }
        ]
      }
    ],
    "Stop": [
      {
        "type": "command",
        "command": "node island-hook.cjs Stop",
        "timeout": 5
      }
    ]
  }
};

fs.writeFileSync(hooksFile, JSON.stringify(hooksConfig, null, 2), 'utf8');
console.log(`[AI Island] Installed relative hook configuration into: ${hooksFile}`);
