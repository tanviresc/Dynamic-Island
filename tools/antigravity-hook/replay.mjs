#!/usr/bin/env node
/**
 * Antigravity Trace Replay Tool
 * Reads a trace file and runs it through the AntigravityStateMachine without Antigravity,
 * printing all events the Dynamic Island would receive (with timestamps).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { AntigravityStateMachine } from './state-machine.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function replayTrace(traceFilePath, options = {}) {
  const filePath = traceFilePath || path.join(__dirname, 'fixtures', 'scenario-a.jsonl');
  if (!fs.existsSync(filePath)) {
    throw new Error(`Trace file not found: ${filePath}`);
  }

  const lines = fs.readFileSync(filePath, 'utf8')
    .trim()
    .split('\n')
    .filter(l => l.trim().length > 0)
    .map(l => JSON.parse(l));

  const receivedEvents = [];

  const sm = new AntigravityStateMachine({
    antigravityQuietSeconds: options.quietSeconds ?? 1, // 1s for fast replay testing
    antigravitySuppressSeconds: options.suppressSeconds ?? 2,
    projectFolder: options.projectFolder || 'dynamic island',
    emit: (evt) => {
      const record = {
        time: new Date().toISOString(),
        ...evt
      };
      receivedEvents.push(record);
      console.log(`[REPLAY EVENT] [${record.time}] ${record.type.toUpperCase()}: ${record.message} (taskId: ${record.taskId || 'default'})`);
    }
  });

  console.log(`[AI Island Replay] Starting replay of ${lines.length} events from ${path.basename(filePath)}...`);

  for (let i = 0; i < lines.length; i++) {
    const record = lines[i];
    sm.processEvent(record);

    // If simulating real delay
    if (options.realtime && i < lines.length - 1) {
      const delta = Math.min(Math.max(lines[i + 1].timestamp - record.timestamp, 0), 1000);
      await new Promise(r => setTimeout(r, delta));
    }
  }

  // Wait for quiet-time completion to fire
  const waitMs = ((options.quietSeconds ?? 1) * 1000) + 150;
  await new Promise(r => setTimeout(r, waitMs));

  sm.destroy();
  return receivedEvents;
}

// If executed directly from command line
if (process.argv[1] === __filename) {
  const argPath = process.argv[2];
  const isRealtime = process.argv.includes('--realtime');

  replayTrace(argPath, { realtime: isRealtime, quietSeconds: 1 })
    .then((events) => {
      const finishedEvents = events.filter(e => e.type === 'finished');
      console.log(`\n--- REPLAY SUMMARY ---`);
      console.log(`Total events emitted to island: ${events.length}`);
      console.log(`Finished events emitted: ${finishedEvents.length}`);
      if (finishedEvents.length === 1) {
        console.log(`✓ TEST PASSED: Exactly ONE finished event was emitted at the end.`);
        process.exit(0);
      } else {
        console.error(`✗ TEST FAILED: Expected exactly 1 finished event, got ${finishedEvents.length}`);
        process.exit(1);
      }
    })
    .catch((err) => {
      console.error('[REPLAY ERROR]', err);
      process.exit(1);
    });
}

