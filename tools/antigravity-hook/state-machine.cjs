/**
 * Antigravity Task State Machine (CommonJS)
 * Manages lifecycle events per (site, taskId), quiet-time completion detection,
 * approval tracking, suppression window, and event emissions for AI Island.
 */

class AntigravityStateMachine {
  constructor(options = {}) {
    this.quietSeconds = options.antigravityQuietSeconds ?? 8;
    this.suppressSeconds = options.antigravitySuppressSeconds ?? 10;
    this.emit = options.emit || (() => {});
    this.defaultProjectFolder = options.projectFolder || 'dynamic island';
    this.tasks = new Map(); // taskId -> TaskState
  }

  getTask(taskId) {
    const tid = (typeof taskId === 'string' && taskId.trim().length > 0) ? taskId.trim() : 'default';
    if (!this.tasks.has(tid)) {
      this.tasks.set(tid, {
        id: tid,
        state: 'idle', // 'idle' | 'running' | 'needs_input' | 'finished' | 'stopped'
        taskTitle: this.defaultProjectFolder,
        quietTimer: null,
        suppressTimer: null,
        approvalPending: false,
        lastEventTime: 0,
        finishedEmitted: false,
        activeTurn: false,
        evidence: {
          edited: 0,
          created: 0,
          commands: 0,
          searches: 0,
          images: 0,
          approvals: 0,
          steps: 0
        }
      });
    }
    return this.tasks.get(tid);
  }

  extractTitle(payload, currentTitle) {
    if (!payload) return currentTitle || this.defaultProjectFolder;
    const prompt = payload.lastUserInput;
    if (typeof prompt === 'string' && prompt.trim().length > 0) {
      let text = prompt
        .replace(/<[^>]+>/g, ' ')
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`[^`]+`/g, ' ')
        .replace(/https?:\/\/\S+/g, ' ')
        .replace(/[\r\n\t]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

      if (!text) return currentTitle || this.defaultProjectFolder;

      let cleaned = text
        .replace(/^(?:please|can you|could you|would you|will you|help me to|help me|i want you to|i need you to|i'd like you to|tell me|give me|show me|how to|what is|write a|generate a|create a)\s+/i, '')
        .replace(/^(?:hi|hello|hey|greetings|antigravity|claude|chatgpt|gemini)[,\s:]+/i, '')
        .trim();

      cleaned = cleaned.split(/[.?!\n;]/)[0].trim();

      if (cleaned.length >= 3) {
        cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
        if (cleaned.length > 35) {
          cleaned = cleaned.slice(0, 32).trimEnd() + '...';
        }
        return cleaned;
      }
    }
    return currentTitle || this.defaultProjectFolder;
  }

  formatFinished(taskTitle, evidence, maxLen = 120) {
    const counts = [];
    if (evidence.edited > 0) counts.push(`${evidence.edited} edited`);
    if (evidence.created > 0) counts.push(`${evidence.created} created`);
    if (evidence.commands > 0) counts.push(`${evidence.commands} ${evidence.commands === 1 ? 'command' : 'commands'}`);
    if (evidence.searches > 0) counts.push(`${evidence.searches} ${evidence.searches === 1 ? 'search' : 'searches'}`);
    if (evidence.images > 0) counts.push(`${evidence.images} ${evidence.images === 1 ? 'image generated' : 'images generated'}`);

    const countsStr = counts.length > 0 ? ` · ${counts.join(' · ')}` : '';
    const title = (taskTitle || '').trim();

    let msg = '';
    if (title && title !== 'Task' && title !== this.defaultProjectFolder) {
      msg = `Done: ${title}${countsStr}`;
    } else if (counts.length > 0) {
      msg = `Task finished${countsStr}`;
    } else {
      msg = 'Task finished';
    }

    if (msg.length > maxLen) {
      const available = maxLen - `Done: ...${countsStr}`.length;
      if (available > 5) {
        msg = `Done: ${title.slice(0, available).trimEnd()}...${countsStr}`;
      } else {
        msg = msg.slice(0, maxLen - 3).trimEnd() + '...';
      }
    }
    return msg;
  }

  formatStopped(taskTitle, evidence, maxLen = 120) {
    const title = (taskTitle || '').trim();
    const stepStr = evidence.steps > 0 ? ` (after ${evidence.steps} ${evidence.steps === 1 ? 'step' : 'steps'})` : '';
    let msg = '';
    if (title && title !== 'Task' && title !== this.defaultProjectFolder) {
      msg = `Stopped: ${title}${stepStr}`;
    } else {
      msg = `Task stopped${stepStr}`;
    }
    return msg.length > maxLen ? msg.slice(0, maxLen - 3).trimEnd() + '...' : msg;
  }

  isApprovalRequired(toolName, toolCall, payload) {
    const name = String(toolName || payload?.tool || payload?.toolName || '').toLowerCase();
    const args = toolCall?.args || payload?.args || {};

    if (name === 'ask_question' || name.startsWith('ask_') || name === 'ask' || name.includes('question')) {
      return true;
    }
    if (name.includes('confirm') || name.includes('approval') || name.includes('permission')) {
      return true;
    }
    if (name === 'run_command' && args.BypassSandbox === true) {
      return true;
    }
    return false;
  }

  formatApprovalDesc(toolName, toolCall, payload) {
    const name = String(toolName || payload?.tool || payload?.toolName || '');
    const args = toolCall?.args || payload?.args || {};

    if (name.includes('ask_question')) {
      if (Array.isArray(args.questions) && args.questions.length > 0) {
        const q = args.questions[0];
        const text = typeof q === 'string' ? q : (q.question || '');
        if (text) {
          return text.length > 35 ? text.slice(0, 32).trimEnd() + '...' : text;
        }
      }
      return 'user prompt';
    }

    if (name === 'run_command') {
      const cmd = args.CommandLine ? String(args.CommandLine).replace(/[\r\n\t]+/g, ' ').trim() : '';
      if (cmd) {
        return cmd.length > 35 ? cmd.slice(0, 32).trimEnd() + '...' : cmd;
      }
      return 'terminal command';
    }

    return name || 'action';
  }

  clearTimers(task) {
    if (task.quietTimer) {
      clearTimeout(task.quietTimer);
      task.quietTimer = null;
    }
    if (task.suppressTimer) {
      clearTimeout(task.suppressTimer);
      task.suppressTimer = null;
    }
  }

  scheduleQuietTimer(task) {
    if (task.quietTimer) {
      clearTimeout(task.quietTimer);
      task.quietTimer = null;
    }

    // Do not finish while approval is pending
    if (task.approvalPending) return;

    task.quietTimer = setTimeout(() => {
      this.finishTurn(task);
    }, this.quietSeconds * 1000);
  }

  finishTurn(task) {
    if (task.quietTimer) {
      clearTimeout(task.quietTimer);
      task.quietTimer = null;
    }

    if (task.state === 'running' || task.state === 'needs_input') {
      task.state = 'finished';
      task.approvalPending = false;
      task.finishedEmitted = true;
      task.activeTurn = false;

      const msg = this.formatFinished(task.taskTitle, task.evidence);
      this.emit({
        type: 'finished',
        site: 'antigravity',
        source: 'ide',
        taskId: task.id !== 'default' ? task.id : undefined,
        message: msg
      });

      task.suppressTimer = setTimeout(() => {
        task.suppressTimer = null;
      }, this.suppressSeconds * 1000);
    }
  }

  /**
   * Process a hook lifecycle event
   * @param {Object} hookRecord - { event, timestamp, taskId, toolName, toolCall, lastUserInput, ... }
   */
  processEvent(hookRecord) {
    if (!hookRecord) return;
    const eventName = (hookRecord.event || hookRecord.hook || hookRecord.eventName || '').toLowerCase();
    const taskId = hookRecord.taskId || hookRecord.conversationId;
    const task = this.getTask(taskId);

    task.lastEventTime = hookRecord.timestamp || Date.now();
    task.taskTitle = this.extractTitle(hookRecord, task.taskTitle);

    // 1. PreInvocation: agent starts a turn
    if (eventName.includes('preinvocation') || eventName === 'start' || eventName === 'working') {
      if (task.state === 'finished' && task.suppressTimer) {
        clearTimeout(task.suppressTimer);
        task.suppressTimer = null;
      }

      task.activeTurn = true;
      task.finishedEmitted = false;
      task.approvalPending = false;

      // Reset counters for new turn
      task.evidence = {
        edited: 0,
        created: 0,
        commands: 0,
        searches: 0,
        images: 0,
        approvals: 0,
        steps: 0
      };

      if (task.state !== 'running') {
        task.state = 'running';
        this.emit({
          type: 'working',
          site: 'antigravity',
          source: 'ide',
          taskId: task.id !== 'default' ? task.id : undefined,
          message: `Working: ${task.taskTitle}`
        });
      }

      this.scheduleQuietTimer(task);
      return;
    }

    // 2. PreToolUse: tool is about to be called
    if (eventName.includes('pretooluse')) {
      const toolCall = hookRecord.toolCall || {};
      const toolName = String(hookRecord.toolName || toolCall.name || hookRecord.tool || '').toLowerCase();
      const args = toolCall.args || toolCall.arguments || hookRecord.args || hookRecord.arguments || {};

      task.evidence.steps++;

      if (toolName === 'edit_file') {
        task.evidence.edited++;
      } else if (toolName === 'write_file') {
        const filePath = String(args.Path || args.path || '').toLowerCase();
        if (/\.(?:png|jpe?g|webp|gif)$/i.test(filePath)) {
          task.evidence.images++;
        } else {
          task.evidence.created++;
        }
      } else if (toolName === 'run_command') {
        task.evidence.commands++;
        if (args.BypassSandbox === true) {
          task.evidence.approvals++;
        }
      } else if (toolName.includes('search') || toolName === 'search_web') {
        task.evidence.searches++;
      } else if (
        toolName.includes('image_generator') ||
        toolName.includes('image-generator') ||
        toolName.includes('generate_image')
      ) {
        task.evidence.images++;
      }

      if (this.isApprovalRequired(toolName, toolCall, hookRecord)) {
        task.approvalPending = true;
        task.state = 'needs_input';
        task.evidence.approvals++;
        if (task.quietTimer) {
          clearTimeout(task.quietTimer);
          task.quietTimer = null;
        }

        let what = 'run a command';
        if (toolName === 'edit_file') what = 'edit a file';
        else if (toolName === 'write_file') what = 'create a file';
        else if (toolName.includes('ask_question') || toolName.startsWith('ask_')) what = 'answer question';
        else if (toolName.includes('image')) what = 'generate an image';

        this.emit({
          type: 'needs_input',
          site: 'antigravity',
          source: 'ide',
          taskId: task.id !== 'default' ? task.id : undefined,
          message: `Needs approval: ${what}`
        });
      } else {
        task.approvalPending = false;
        if (task.state !== 'running') {
          task.state = 'running';
          this.emit({
            type: 'working',
            site: 'antigravity',
            source: 'ide',
            taskId: task.id !== 'default' ? task.id : undefined,
            message: `Working: ${task.taskTitle}`
          });
        }
        this.scheduleQuietTimer(task);
      }
      return;
    }

    // 3. PostToolUse: tool execution finished
    if (eventName.includes('posttooluse')) {
      if (task.approvalPending) {
        task.approvalPending = false;
        task.state = 'running';
        this.emit({
          type: 'working',
          site: 'antigravity',
          source: 'ide',
          taskId: task.id !== 'default' ? task.id : undefined,
          message: `Working: ${task.taskTitle}`
        });
      }
      this.scheduleQuietTimer(task);
      return;
    }

    // 4. PostInvocation: intermediate turn step
    if (eventName.includes('postinvocation')) {
      this.scheduleQuietTimer(task);
      return;
    }

    // 5. Stop: execution loop termination
    if (eventName.includes('stop') || eventName.includes('cancel')) {
      this.clearTimers(task);
      task.activeTurn = false;
      task.approvalPending = false;

      const reason = (hookRecord.terminationReason || '').toUpperCase();
      const isCancel = reason.includes('CANCEL');
      const isError = reason.includes('ERROR') || Boolean(hookRecord.error);

      if (isCancel || isError) {
        task.state = 'stopped';
        const msg = this.formatStopped(task.taskTitle, task.evidence);
        this.emit({
          type: 'stopped',
          site: 'antigravity',
          source: 'ide',
          taskId: task.id !== 'default' ? task.id : undefined,
          message: msg
        });
      } else {
        task.state = 'finished';
        task.finishedEmitted = true;
        const msg = this.formatFinished(task.taskTitle, task.evidence);
        this.emit({
          type: 'finished',
          site: 'antigravity',
          source: 'ide',
          taskId: task.id !== 'default' ? task.id : undefined,
          message: msg
        });
      }
      return;
    }
  }

  destroy() {
    for (const task of this.tasks.values()) {
      this.clearTimers(task);
    }
    this.tasks.clear();
  }
}

module.exports = { AntigravityStateMachine };
