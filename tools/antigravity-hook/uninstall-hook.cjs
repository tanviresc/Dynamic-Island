#!/usr/bin/env node
/**
 * Uninstaller for Antigravity Island Hook.
 * Removes the island hook entry from .agents/hooks.json.
 */

const fs = require('fs');
const path = require('path');

const hooksFile = path.resolve(process.cwd(), '.agents', 'hooks.json');

if (!fs.existsSync(hooksFile)) {
  console.log('[AI Island] No .agents/hooks.json found. Nothing to uninstall.');
  process.exit(0);
}

try {
  const content = fs.readFileSync(hooksFile, 'utf8');
  const hooksConfig = JSON.parse(content);
  if (hooksConfig['island-notification']) {
    delete hooksConfig['island-notification'];
    fs.writeFileSync(hooksFile, JSON.stringify(hooksConfig, null, 2), 'utf8');
    console.log('[AI Island] Removed island-notification hook from .agents/hooks.json.');
  } else {
    console.log('[AI Island] island-notification hook not present in .agents/hooks.json.');
  }
} catch (e) {
  console.error('[AI Island] Failed to update hooks.json:', e);
}

