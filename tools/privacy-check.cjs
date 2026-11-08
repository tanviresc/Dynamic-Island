#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');

// Prohibited leak patterns: logging actual user prompt strings, response body text, or secret tokens
const LEAK_PATTERNS = [
  // Prompt text leaks
  /\.log\([^)]*\b(?:rawPrompt|lastPrompt|userPromptText|promptText)\b/i,
  /console\.(?:log|info|warn|error)\([^)]*\b(?:rawPrompt|lastPrompt|userPromptText|promptText)\b/i,

  // AI response content leaks (chunks, full response bodies, text slices)
  /\.log\([^)]*\b(?:chunkText|streamAccumulated|responseText|messageContent)\b/i,
  /console\.(?:log|info|warn|error)\([^)]*\b(?:chunkText|streamAccumulated|responseText|messageContent)\b/i,
  /\.log\([^)]*\.slice\(\s*0\s*,\s*\d+\s*\)/i,

  // Token value logging (printing actual token variable value)
  /println!\([^)]*[{][^}]*[}][^)]*\b(?:new_token|token_received|actual|expected)\b/i,
  /eprintln!\([^)]*[{][^}]*[}][^)]*\b(?:new_token|token_received|actual|expected)\b/i,
  /console\.(?:log|info|warn|error)\([^)]*\$\{\s*token\s*\}/i
];

const SCAN_DIRS = [
  path.join(ROOT_DIR, 'ai-extension'),
  path.join(ROOT_DIR, '.agents'),
  path.join(ROOT_DIR, 'src'),
  path.join(ROOT_DIR, 'src-tauri', 'src')
];

let violations = 0;

function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('//') || trimmed.startsWith('/*') || trimmed.startsWith('*')) return;

    for (const pattern of LEAK_PATTERNS) {
      if (pattern.test(line)) {
        console.error(`[PRIVACY VIOLATION] ${filePath}:${idx + 1}`);
        console.error(`  > ${trimmed}`);
        violations++;
      }
    }
  });
}

function walkDir(dir) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name !== 'node_modules' && entry.name !== 'target' && entry.name !== '.git') {
        walkDir(fullPath);
      }
    } else if (/\.(js|cjs|mjs|rs|html|ts)$/.test(entry.name)) {
      scanFile(fullPath);
    }
  }
}

console.log('[PRIVACY AUDIT] Scanning codebase for prompt/response/token leaks...');
for (const d of SCAN_DIRS) {
  walkDir(d);
}

if (violations === 0) {
  console.log('✓ PASS: Zero prompt text, response bodies, or auth secrets are logged or leaked.');
  process.exit(0);
} else {
  console.error(`✗ FAIL: ${violations} privacy violation(s) detected!`);
  process.exit(1);
}
