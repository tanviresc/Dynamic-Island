// Dynamic Island Controller (Redesigned Dots, Pill Look, Smooth Animation & Fullscreen Armed Cycle)
let appConfig = null;

// State model: Each site tracks state per taskId: siteTasks[site][taskId] = state
// The aggregate site state for the dots is the highest priority state across tasks:
// Priority order: 'needs_input' > 'stopped' > 'running' > 'finished' > 'none'
const siteTasks = {
  claude: {},
  chatgpt: {},
  gemini: {},
  antigravity: {}
};

const siteStates = {
  claude: 'none',
  chatgpt: 'none',
  gemini: 'none',
  antigravity: 'none'
};

const TASK_PRIORITY = ['needs_input', 'stopped', 'running', 'finished'];

function computeAggregateSiteState(site) {
  const tasks = siteTasks[site] || {};
  const activeTaskStates = Object.values(tasks).filter(st => st && st !== 'none');
  for (const prio of TASK_PRIORITY) {
    if (activeTaskStates.includes(prio)) {
      return prio;
    }
  }
  return 'none';
}

const taskTimestamps = {};

function setTaskState(site, taskId, state) {
  if (!siteTasks[site]) {
    siteTasks[site] = {};
  }
  const tid = taskId || 'default';
  siteTasks[site][tid] = state;
  taskTimestamps[`${site}:${tid}`] = Date.now();

  // Prune task map if it grows beyond 100 entries per site
  const keys = Object.keys(siteTasks[site]);
  if (keys.length > 100) {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    for (const k of keys) {
      if (k === 'default') continue;
      const ts = taskTimestamps[`${site}:${k}`] || 0;
      const st = siteTasks[site][k];
      if ((st === 'finished' || st === 'stopped' || st === 'none') && (ts < oneDayAgo || keys.length > 150)) {
        delete siteTasks[site][k];
        delete taskTimestamps[`${site}:${k}`];
      }
    }
  }

  siteStates[site] = computeAggregateSiteState(site);
}

const ORDERED_STATES = ['needs_input', 'stopped', 'running', 'finished'];

let isPillActive = false;
let isDndActive = false;
let notificationQueue = [];
let historyStore = [];

// Fullscreen Armed Cycle State Machine
let isFullscreenMode = false;
let isCycleArmed = false;
let fullscreenPhase = 'not_armed'; // 'not_armed' | 'visible' | 'hidden'
let fullscreenSecondsLeft = 0;
let fullscreenInterval = null; // Strictly one timer at a time

// Active Context Detection & Suppression State (Part B)
let currentActiveContext = 'none'; // 'none' | 'antigravity' | 'claude_desktop' | 'chatgpt_desktop' | 'claude_web' | 'chatgpt_web' | 'gemini_web'

function getSiteForContext(context) {
  if (!context || context === 'none') return null;
  if (context === 'antigravity') return 'antigravity';
  if (context.startsWith('claude')) return 'claude';
  if (context.startsWith('chatgpt')) return 'chatgpt';
  if (context.startsWith('gemini')) return 'gemini';
  return null;
}

function hasActiveNeedsInput() {
  return Object.values(siteStates).includes('needs_input');
}

function updateContextSuppressionUI() {
  const needsInputBreaksThrough = appConfig?.contextSuppression?.needsInputBreaksThrough ?? true;
  const inMonitoredContext = (currentActiveContext !== 'none');

  if (inMonitoredContext) {
    if (hasActiveNeedsInput() && needsInputBreaksThrough) {
      dotsContainer.classList.remove('context-suppressed');
    } else {
      dotsContainer.classList.add('context-suppressed');
    }
  } else {
    dotsContainer.classList.remove('context-suppressed');
  }
}

function setContextMode(newContext) {
  currentActiveContext = newContext || 'none';

  if (currentActiveContext !== 'none') {
    // Dismiss active pill unless needs_input that breaks through
    const needsInputBreaksThrough = appConfig?.contextSuppression?.needsInputBreaksThrough ?? true;
    if (isPillActive) {
      const isNeedsInput = (currentActivePill?.targetState === 'needs_input');
      if (!isNeedsInput || !needsInputBreaksThrough) {
        if (pillHoldTimer) { clearTimeout(pillHoldTimer); pillHoldTimer = null; }
        if (pillShrinkTimer) { clearTimeout(pillShrinkTimer); pillShrinkTimer = null; }
        pillEl.classList.remove('open', 'shrinking', 'pulsing', 'show-type-icon', 'content-faded');
        isPillActive = false;
        currentActivePill = null;
      }
    }

    // Entering an app marks its existing unread items as read (EXCEPT needs_input)
    const activeSite = getSiteForContext(currentActiveContext);
    if (activeSite && siteTasks[activeSite]) {
      Object.keys(siteTasks[activeSite]).forEach(tid => {
        const st = siteTasks[activeSite][tid];
        if (st === 'finished' || st === 'stopped') {
          siteTasks[activeSite][tid] = 'none';
        }
      });
      siteStates[activeSite] = computeAggregateSiteState(activeSite);
    }
  }

  updateContextSuppressionUI();

  if (isFullscreenMode) {
    syncFullscreenCycle();
  } else {
    renderDots();
  }

  updateFullscreenStatus(fullscreenPhase, fullscreenSecondsLeft);
}

let isHistoryOpen = false;
let autoCloseTimer = null;
let currentActivePill = null; // { site, tabId, windowId, historyId, targetState }
let pillHoldTimer = null;
let pillShrinkTimer = null;

const dotsContainer = document.getElementById('dots-container');
const pillEl = document.getElementById('pill');
const pillIconEl = document.getElementById('pill-icon');
const pillTextEl = document.getElementById('pill-text');
const historyPanel = document.getElementById('history-panel');
const historyContent = document.getElementById('history-content');
const btnClearHistory = document.getElementById('history-clear');

async function loadConfig() {
  try {
    if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
      appConfig = await window.__TAURI__.core.invoke('get_config');
    }
  } catch (e) {
    console.warn('Failed to invoke get_config, falling back to fetch', e);
  }

  if (!appConfig) {
    try {
      const res = await fetch('config.json');
      appConfig = await res.json();
    } catch (e) {
      console.error('Failed to load config.json', e);
    }
  }

  if (appConfig) {
    if (!appConfig.sites) {
      appConfig.sites = {
        claude: { label: "Claude", icon: "C", color: "#ff7a00", logo: "logos/claude.svg", tint: "original" },
        chatgpt: { label: "ChatGPT", icon: "G", color: "#ff4081", logo: "logos/chatgpt.svg", tint: "white" },
        gemini: { label: "Gemini", icon: "G", color: "#9c27b0", logo: "logos/gemini.svg", tint: "original" },
        antigravity: { label: "Antigravity", icon: "A", color: "#00bcd4", logo: "logos/antigravity.svg", tint: "original" }
      };
    }
    Object.keys(appConfig.sites).forEach(s => {
      if (siteStates[s] === undefined) {
        siteStates[s] = 'none';
      }
      if (!siteTasks[s]) {
        siteTasks[s] = {};
      }
    });
    isDndActive = Boolean(appConfig.doNotDisturb);
    applyConfig();
    loadSavedHistory();
    if (window.islandSound) {
      window.islandSound.init(appConfig.sound);
    }
    renderDots();
  }
}

function applyConfig() {
  if (!appConfig) return;
  const root = document.documentElement;

  // Island Scale (Part B)
  const scale = typeof appConfig.islandScale === 'number' ? appConfig.islandScale : 0.8;
  root.style.setProperty('--island-scale', scale);

  // Idle dots config (NOT scaled per spec)
  if (appConfig.idleDots) {
    const dots = appConfig.idleDots;
    const dotSize = dots.dotSize ?? dots.size ?? 4;
    const dotGap = dots.dotGap ?? dots.gap ?? 4;
    const glowBlur = dots.dotGlowBlur ?? 4;
    const glowSpread = dots.dotGlowSpread ?? 1;
    const glowOpacity = dots.dotGlowOpacity ?? 0.6;
    const hitHeight = dots.hitAreaHeight ?? 24;
    const hitPadX = dots.hitAreaPaddingX ?? 10;

    root.style.setProperty('--dot-size', `${dotSize}px`);
    root.style.setProperty('--dot-gap', `${dotGap}px`);
    root.style.setProperty('--dot-glow-blur', `${glowBlur}px`);
    root.style.setProperty('--dot-glow-spread', `${glowSpread}px`);
    root.style.setProperty('--dot-glow-opacity', `${glowOpacity}`);
    root.style.setProperty('--dots-hit-height', `${hitHeight}px`);
    root.style.setProperty('--dots-hit-pad-x', `${hitPadX}px`);
    root.style.setProperty('--dot-none-color', dots.noneColor || 'rgba(255, 255, 255, 0.85)');
    root.style.setProperty('--dot-transition-ms', `${dots.transitionMs || 300}ms`);
    root.style.setProperty('--pulse-cycle', `${dots.pulseCycleMs || 2000}ms`);

    if (dots.colors) {
      root.style.setProperty('--dot-color-needs-input', dots.colors.needs_input || '#ff7a00');
      root.style.setProperty('--dot-color-stopped', dots.colors.stopped || '#f44336');
      root.style.setProperty('--dot-color-running', dots.colors.running || '#2196f3');
      root.style.setProperty('--dot-color-finished', dots.colors.finished || '#4caf50');
    }
  }

  // Fullscreen config
  if (appConfig.fullscreen) {
    const fs = appConfig.fullscreen;
    root.style.setProperty('--fullscreen-pulse-cycle', `${(fs.pulseCycleSec || 2.5) * 1000}ms`);
    root.style.setProperty('--fullscreen-fade-ms', `${fs.fadeDurationMs || 400}ms`);
  }

  // Pill base metrics (scaled via CSS variables using --island-scale)
  if (appConfig.pill) {
    const p = appConfig.pill;
    root.style.setProperty('--base-pill-height', `${p.height || 40}px`);
    root.style.setProperty('--pill-target-width', `${p.targetWidth || 'max-content'}`);
    root.style.setProperty('--base-pill-min-width', `${p.minWidth || 260}px`);
    root.style.setProperty('--pill-max-width', `${p.maxWidthPercent || 88}%`);
    root.style.setProperty('--base-pill-padding-x', `${p.paddingX || 22}px`);
    root.style.setProperty('--base-pill-border-width', `${p.borderWidth || 1.5}px`);
    root.style.setProperty('--pill-text-color', `${p.textColor || '#ffffff'}`);
    root.style.setProperty('--base-pill-text-size', `${p.textSize || 13}px`);
    root.style.setProperty('--base-pill-icon-size', `${p.iconSize || 18}px`);
    root.style.setProperty('--base-pill-gap', `${p.gap || 10}px`);
    root.style.setProperty('--pill-expand-duration', `${p.expandDurationMs || 1000}ms`);
    root.style.setProperty('--pill-shrink-duration', `${p.shrinkDurationMs || 900}ms`);
    root.style.setProperty('--text-fade-duration', `${p.textFadeOutMs || 250}ms`);
    root.style.setProperty('--pill-easing', `${p.easing || 'cubic-bezier(0.45, 0, 0.15, 1)'}`);
  }

  // History panel config
  if (appConfig.history) {
    const h = appConfig.history;
    const panelOpacity = h.panelBackgroundOpacity !== undefined ? h.panelBackgroundOpacity : 0.85;
    root.style.setProperty('--panel-bg', `rgba(18, 18, 22, ${panelOpacity})`);
    root.style.setProperty('--panel-transition-duration', `${h.panelTransitionMs || 300}ms`);
  }
}

// Return active distinct states ordered: ['needs_input', 'stopped', 'running', 'finished']
function getActiveDistinctStates() {
  const activeValues = Object.values(siteStates);
  return ORDERED_STATES.filter(st => activeValues.includes(st));
}

// Render dynamic dots row
function renderDots(newTargetState = null) {
  const distinct = getActiveDistinctStates();
  const statesToDisplay = distinct.length > 0 ? distinct : ['none'];

  dotsContainer.innerHTML = '';
  statesToDisplay.forEach(state => {
    const dot = document.createElement('div');
    dot.className = `state-dot ${state}`;
    dot.setAttribute('data-state', state);
    if (newTargetState && state === newTargetState) {
      dot.classList.add('entering');
    }
    dotsContainer.appendChild(dot);
  });
}

// Measure target dot position relative to island window center
function measureDotOffset(targetState) {
  if (!targetState || targetState === 'none') {
    return { x: 0, y: 0 };
  }
  const dotEl = dotsContainer.querySelector(`.state-dot[data-state="${targetState}"]`);
  if (!dotEl) {
    return { x: 0, y: 0 };
  }
  const dotRect = dotEl.getBoundingClientRect();
  const windowCenterX = window.innerWidth / 2;
  const deltaX = (dotRect.left + dotRect.width / 2) - windowCenterX;

  const scale = typeof appConfig?.islandScale === 'number' ? appConfig.islandScale : 0.8;
  const baseHeight = appConfig?.pill?.height || 40;
  const pillHeight = pillEl.offsetHeight > 0 ? pillEl.offsetHeight : (baseHeight * scale);
  const restingPillCenterY = 18 + (pillHeight / 2);
  const dotCenterY = dotRect.top + (dotRect.height / 2);
  const deltaY = dotCenterY - restingPillCenterY;

  return { x: Math.round(deltaX), y: Math.round(deltaY) };
}

// Map event type to site state
function mapEventTypeToSiteState(type) {
  if (type === 'working' || type === 'step') return 'running';
  if (type === 'finished') return 'finished';
  if (type === 'stopped' || type === 'limit_reached') return 'stopped';
  if (type === 'needs_input') return 'needs_input';
  if (type === 'resolve_needs_input') return 'none';
  return null;
}

// Fullscreen Armed Cycle Logic
function isFullscreenCycleArmed() {
  // Armed only when at least one site is in finished, stopped, or needs_input.
  // Running does not arm it.
  return Object.values(siteStates).some(st =>
    st === 'finished' || st === 'stopped' || st === 'needs_input'
  );
}

function clearFullscreenTimer() {
  if (fullscreenInterval) {
    clearInterval(fullscreenInterval);
    fullscreenInterval = null;
  }
}

function updateFullscreenStatus(phase, secondsLeft = 0) {
  fullscreenPhase = phase;
  fullscreenSecondsLeft = secondsLeft;
  const payload = {
    phase: fullscreenPhase,
    secondsLeft: fullscreenSecondsLeft,
    context: currentActiveContext
  };
  // Broadcast globally to all windows (including test panel) via Rust invoke
  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
    window.__TAURI__.core.invoke('emit_island_event', {
      event: 'fullscreen-cycle-status',
      payload: payload
    }).catch(() => {});
  }
  if (window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.emit('fullscreen-cycle-status', payload).catch(() => {});
  }
}

function disarmFullscreenCycle() {
  clearFullscreenTimer();
  isCycleArmed = false;
  dotsContainer.classList.remove('fullscreen-visible');
  dotsContainer.classList.add('fullscreen-cycle-hidden');
  updateFullscreenStatus('not_armed', 0);
}

function startFullscreenTicker() {
  clearFullscreenTimer();
  fullscreenInterval = setInterval(() => {
    if (!isFullscreenMode || !isFullscreenCycleArmed()) {
      disarmFullscreenCycle();
      return;
    }

    fullscreenSecondsLeft--;

    if (fullscreenSecondsLeft <= 0) {
      if (fullscreenPhase === 'visible') {
        const hiddenSec = appConfig?.fullscreen?.hiddenSeconds ?? 45;
        enterFullscreenHiddenPhase(hiddenSec);
      } else if (fullscreenPhase === 'hidden') {
        if (!isFullscreenCycleArmed()) {
          disarmFullscreenCycle();
        } else {
          const periodicSec = appConfig?.fullscreen?.periodicVisibleSeconds ?? (appConfig?.fullscreen?.visibleSeconds ?? 10);
          enterFullscreenVisiblePhase(periodicSec);
        }
      }
    } else {
      updateFullscreenStatus(fullscreenPhase, fullscreenSecondsLeft);
    }
  }, 1000);
}

function enterFullscreenVisiblePhase(durationSec) {
  clearFullscreenTimer();
  if (!isFullscreenMode || !isFullscreenCycleArmed()) {
    disarmFullscreenCycle();
    return;
  }

  isCycleArmed = true;
  fullscreenPhase = 'visible';
  fullscreenSecondsLeft = durationSec;

  renderDots();
  dotsContainer.classList.remove('fullscreen-cycle-hidden', 'hidden');
  dotsContainer.classList.add('fullscreen-visible');
  updateFullscreenStatus('visible', fullscreenSecondsLeft);

  startFullscreenTicker();
}

function enterFullscreenHiddenPhase(durationSec) {
  clearFullscreenTimer();
  if (!isFullscreenMode || !isFullscreenCycleArmed()) {
    disarmFullscreenCycle();
    return;
  }

  isCycleArmed = true;
  fullscreenPhase = 'hidden';
  fullscreenSecondsLeft = durationSec;

  dotsContainer.classList.remove('fullscreen-visible');
  dotsContainer.classList.add('fullscreen-cycle-hidden');
  updateFullscreenStatus('hidden', fullscreenSecondsLeft);

  startFullscreenTicker();
}

function syncFullscreenCycle() {
  if (!isFullscreenMode) {
    clearFullscreenTimer();
    isCycleArmed = false;
    dotsContainer.classList.remove('fullscreen-mode', 'fullscreen-cycle-hidden', 'fullscreen-visible');
    updateFullscreenStatus('not_armed', 0);
    renderDots();
    return;
  }

  dotsContainer.classList.add('fullscreen-mode');

  if (!isFullscreenCycleArmed()) {
    disarmFullscreenCycle();
    return;
  }

  // Armed! If not already cycling, start
  if (!isCycleArmed || fullscreenPhase === 'not_armed') {
    const periodicSec = appConfig?.fullscreen?.periodicVisibleSeconds ?? (appConfig?.fullscreen?.visibleSeconds ?? 10);
    enterFullscreenVisiblePhase(periodicSec);
  } else {
    // Already in cycle
    if (fullscreenPhase === 'visible') {
      renderDots();
    }
  }
}

function setFullscreenMode(enabled) {
  isFullscreenMode = Boolean(enabled);

  if (isFullscreenMode) {
    if (isPillActive) {
      if (pillHoldTimer) { clearTimeout(pillHoldTimer); pillHoldTimer = null; }
      if (pillShrinkTimer) { clearTimeout(pillShrinkTimer); pillShrinkTimer = null; }
      pillEl.classList.remove('open', 'shrinking', 'pulsing', 'show-type-icon', 'content-faded');
      isPillActive = false;
      currentActivePill = null;
    }
    if (isHistoryOpen) {
      toggleHistoryPanel();
    }
  }

  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
    window.__TAURI__.core.invoke('set_fullscreen_active', { active: isFullscreenMode }).catch(() => {});
  }

  syncFullscreenCycle();
}

// Antigravity Task Watchdog & State Machine
const antigravityTasks = {};

function getNotificationMessage(type, site, source, message, taskKind) {
  const kind = taskKind || 'question';
  const siteLower = (site || '').toLowerCase();
  const sourceLower = (source || 'web').toLowerCase();

  // If site is antigravity or source is IDE, respect Antigravity task messages
  if (siteLower === 'antigravity' || sourceLower === 'ide') {
    return message || `${type}`;
  }

  const templates = appConfig?.taskKindTemplates || {};
  const kindGroup = templates[kind] || templates['question'] || {};
  let text = kindGroup[type] || templates['question']?.[type];

  if (!text) {
    text = message || `${type}`;
  }

  // Site name formatting
  const siteConfig = appConfig?.sites?.[siteLower];
  let siteLabel = siteConfig?.label || (siteLower ? siteLower.charAt(0).toUpperCase() + siteLower.slice(1) : '');
  if (sourceLower === 'desktop' && !siteLabel.toLowerCase().includes('desktop')) {
    siteLabel = `${siteLabel} desktop`;
  }

  text = text.replace(/{site}/g, siteLabel).replace(/{kind}/g, kind);

  // Check showSiteInText: config option showSiteInText (default false for web, true for desktop apps, false for ide)
  const showSite = appConfig?.showSiteInText?.[sourceLower] ?? (sourceLower === 'desktop');
  if (showSite) {
    if (!text.toLowerCase().startsWith(siteLabel.toLowerCase())) {
      text = `${siteLabel}: ${text}`;
    }
  }

  return text;
}

function handleAntigravityWatchdog(type, effectiveTaskId, message) {
  if (!antigravityTasks[effectiveTaskId]) {
    // Prune stale antigravity task watchers if map exceeds 100 entries
    const agKeys = Object.keys(antigravityTasks);
    if (agKeys.length > 100) {
      for (const k of agKeys) {
        const t = antigravityTasks[k];
        if (!t.quietTimer && !t.suppressTimer && !t.approvalPending) {
          delete antigravityTasks[k];
          if (Object.keys(antigravityTasks).length <= 100) break;
        }
      }
    }

    antigravityTasks[effectiveTaskId] = {
      taskTitle: 'Task',
      quietTimer: null,
      suppressTimer: null,
      approvalPending: false
    };
  }
  const task = antigravityTasks[effectiveTaskId];

  if (message) {
    task.lastDoneMessage = message;
    if (message.startsWith('Working: ')) task.taskTitle = message.slice(9).trim();
    else if (message.startsWith('Done: ')) task.taskTitle = message.slice(6).trim();
    else if (message.startsWith('Finished: ')) task.taskTitle = message.slice(10).trim();
    else if (message.startsWith('Stopped: ')) {
      const match = message.slice(9).trim();
      if (match) task.taskTitle = match.replace(/\s*\([^)]*\)$/, '').trim();
    }
  }

  if (type === 'working' || type === 'step') {
    if (task.suppressTimer) {
      clearTimeout(task.suppressTimer);
      task.suppressTimer = null;
    }

    task.approvalPending = false;

    if (task.quietTimer) {
      clearTimeout(task.quietTimer);
      task.quietTimer = null;
    }

    const quietSec = appConfig?.antigravityQuietSeconds ?? 8;
    task.quietTimer = setTimeout(() => {
      task.quietTimer = null;
      if (siteTasks.antigravity?.[effectiveTaskId] === 'running') {
        const doneTitle = task.taskTitle || 'Task';
        const finalMsg = task.lastDoneMessage || `Done: ${doneTitle}`;
        handleNotification('finished', 'antigravity', finalMsg, null, null, 'ide', effectiveTaskId);

        const suppressSec = appConfig?.antigravitySuppressSeconds ?? 10;
        task.suppressTimer = setTimeout(() => {
          task.suppressTimer = null;
        }, suppressSec * 1000);
      }
    }, quietSec * 1000);
  } else if (type === 'needs_input') {
    task.approvalPending = true;
    if (task.quietTimer) {
      clearTimeout(task.quietTimer);
      task.quietTimer = null;
    }
  } else if (type === 'finished' || type === 'stopped') {
    if (task.quietTimer) {
      clearTimeout(task.quietTimer);
      task.quietTimer = null;
    }
    task.approvalPending = false;
  }
}

// Notification handler
function handleNotification(type, site, message, tabId, windowId, source = 'web', taskId = null, taskKind = 'question') {
  const defaultTypes = {
    step: { color: "#2196f3", hasPopup: false, holdDurationMs: 0, sound: "none", pulse: false },
    working: { color: "#2196f3", hasPopup: false, holdDurationMs: 0, sound: "none", pulse: false },
    finished: { color: "#4caf50", hasPopup: true, holdDurationMs: 2000, sound: "tick", pulse: false },
    stopped: { color: "#f44336", hasPopup: true, holdDurationMs: 4000, sound: "tick", pulse: false },
    needs_input: { color: "#ff7a00", hasPopup: true, holdDurationMs: 8000, sound: "twoTone", pulse: true },
    limit_reached: { color: "#f44336", hasPopup: true, holdDurationMs: 8000, sound: "tick", pulse: true }
  };

  const notifConfig = appConfig?.notifications?.types?.[type] || defaultTypes[type];
  if (!notifConfig) return;

  const siteLower = (site || '').toLowerCase();
  const sourceLower = (source || 'web').toLowerCase();
  const targetState = mapEventTypeToSiteState(type);
  const effectiveTaskId = (typeof taskId === 'string' && taskId.trim().length > 0) ? taskId.trim() : 'default';
  const effectiveKind = taskKind || 'question';
  const effectiveMessage = getNotificationMessage(type, siteLower, sourceLower, message, effectiveKind);

  // Antigravity watchdog activity tracking
  if (siteLower === 'antigravity') {
    handleAntigravityWatchdog(type, effectiveTaskId, effectiveMessage);
  }

  // Check if this state's dot is brand new across all sites BEFORE updating state
  const currentDistinct = getActiveDistinctStates();

  // Update site and task state
  if (targetState && siteLower) {
    if (siteStates[siteLower] === undefined) {
      siteStates[siteLower] = 'none';
    }
    setTaskState(siteLower, effectiveTaskId, targetState);
  }

  const isNewDot = targetState && targetState !== 'none' && !currentDistinct.includes(targetState);

  // Record history
  let recordedItem = null;
  if (type !== 'working' && type !== 'step') {
    recordedItem = recordHistory(siteLower, type, effectiveMessage, tabId, windowId, sourceLower, effectiveTaskId, effectiveKind);
  }

  // Fullscreen behavior check
  if (isFullscreenMode) {
    const fsCfg = appConfig?.fullscreen || {};
    const needsInputBreaksThrough = Boolean(fsCfg.needsInputBreaksThrough);
    const isBreakthrough = (type === 'needs_input') && needsInputBreaksThrough;

    if (!isBreakthrough) {
      // In fullscreen: NO popups and NO sound!
      const isTriggeringType = (type === 'finished' || type === 'stopped' || type === 'limit_reached' || type === 'needs_input');

      if (isTriggeringType) {
        // Immediate wake for notificationVisibleSeconds (default 10s), restarts if already visible
        const notifSec = appConfig?.fullscreen?.notificationVisibleSeconds ?? (appConfig?.fullscreen?.visibleSeconds ?? 10);
        enterFullscreenVisiblePhase(notifSec);
      } else if (type === 'working' || type === 'step') {
        // "running" alone does not trigger or arm anything.
        if (fullscreenPhase === 'visible') {
          renderDots();
        }
      }
      return;
    }
  }

  // Context Suppression check (Part B)
  const inMonitoredContext = (currentActiveContext !== 'none');
  const contextSite = getSiteForContext(currentActiveContext);
  const isSameSource = Boolean(contextSite && siteLower === contextSite);
  const contextCfg = appConfig?.contextSuppression || {};
  const needsInputBreaksThrough = contextCfg.needsInputBreaksThrough ?? true;
  const isContextBreakthrough = (type === 'needs_input') && needsInputBreaksThrough;

  // Same-source auto-read: events from source S while in S arrive read (no dot waiting), EXCEPT needs_input
  if (inMonitoredContext && isSameSource && type !== 'needs_input') {
    if (type === 'finished' || type === 'stopped' || type === 'limit_reached') {
      if (siteTasks[siteLower]) {
        siteTasks[siteLower][effectiveTaskId] = 'none';
        siteStates[siteLower] = computeAggregateSiteState(siteLower);
      }
    }
    updateContextSuppressionUI();
    return;
  }

  // Monitored context: suppress popup & sound unless needs_input breakthrough
  if (inMonitoredContext && !isContextBreakthrough) {
    updateContextSuppressionUI();
    return;
  }

  if (isContextBreakthrough) {
    updateContextSuppressionUI();
  }

  // Do Not Disturb check
  if (isDndActive) {
    if (isFullscreenMode) {
      syncFullscreenCycle();
    } else {
      renderDots(isNewDot ? targetState : null);
    }
    return;
  }

  // If no popup required (e.g. working)
  if (!notifConfig.hasPopup) {
    if (isFullscreenMode) {
      syncFullscreenCycle();
    } else {
      renderDots(isNewDot ? targetState : null);
    }
    return;
  }

  const historyId = recordedItem ? recordedItem.id : null;

  // Queue if a pill is currently active
  if (isPillActive) {
    if (notificationQueue.length >= 20) {
      notificationQueue.shift(); // Drop oldest unplayed notification during floods
    }
    notificationQueue.push({
      type,
      site: siteLower,
      source: sourceLower,
      message: effectiveMessage,
      taskKind: effectiveKind,
      tabId,
      windowId,
      notifConfig,
      historyId,
      targetState,
      taskId: effectiveTaskId
    });
    if (!isFullscreenMode) {
      renderDots();
    }
    return;
  }

  // If dot is brand new and on normal desktop, show dot first (~300ms), wait ~150ms, then expand pill
  if (isNewDot && !isFullscreenMode) {
    renderDots(targetState);
    const dotIntroDuration = appConfig?.pill?.dotIntroDurationMs || 300;
    const dotPause = appConfig?.pill?.dotPauseMs || 150;
    setTimeout(() => {
      showPopup(type, siteLower, effectiveMessage, tabId, windowId, notifConfig, historyId, targetState, sourceLower, effectiveTaskId);
    }, dotIntroDuration + dotPause);
  } else {
    if (!isFullscreenMode) {
      renderDots();
    }
    showPopup(type, siteLower, effectiveMessage, tabId, windowId, notifConfig, historyId, targetState, sourceLower, effectiveTaskId);
  }
}

// Embedded SVGs for immediate, zero-latency logo rendering (never fails load)
const EMBEDDED_LOGOS = {
  claude: `<svg width="100%" height="100%" viewBox="0 0 248 248" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M52.4285 162.873L98.7844 136.879L99.5485 134.602L98.7844 133.334H96.4921L88.7237 132.862L62.2346 132.153L39.3113 131.207L17.0249 130.026L11.4214 128.844L6.2 121.873L6.7094 118.447L11.4214 115.257L18.171 115.847L33.0711 116.911L55.485 118.447L71.6586 119.392L95.728 121.873H99.5485L100.058 120.337L98.7844 119.392L97.7656 118.447L74.5877 102.732L49.4995 86.1905L36.3823 76.62L29.3779 71.7757L25.8121 67.2858L24.2839 57.3608L30.6515 50.2716L39.3113 50.8623L41.4763 51.4531L50.2636 58.1879L68.9842 72.7209L93.4357 90.6804L97.0015 93.6343L98.4374 92.6652L98.6571 91.9801L97.0015 89.2625L83.757 65.2772L69.621 40.8192L63.2534 30.6579L61.5978 24.632C60.9565 22.1032 60.579 20.0111 60.579 17.4246L67.8381 7.49965L71.9133 6.19995L81.7193 7.49965L85.7946 11.0443L91.9074 24.9865L101.714 46.8451L116.996 76.62L121.453 85.4816L123.873 93.6343L124.764 96.1155H126.292V94.6976L127.566 77.9197L129.858 57.3608L132.15 30.8942L132.915 23.4505L136.608 14.4708L143.994 9.62643L149.725 12.344L154.437 19.0788L153.8 23.4505L150.998 41.6463L145.522 70.1215L141.957 89.2625H143.994L146.414 86.7813L156.093 74.0206L172.266 53.698L179.398 45.6635L187.803 36.802L193.152 32.5484H203.34L210.726 43.6549L207.415 55.1159L196.972 68.3492L188.312 79.5739L175.896 96.2095L168.191 109.585L168.882 110.689L170.738 110.53L198.755 104.504L213.91 101.787L231.994 98.7149L240.144 102.496L241.036 106.395L237.852 114.311L218.495 119.037L195.826 123.645L162.07 131.592L161.696 131.893L162.137 132.547L177.36 133.925L183.855 134.279H199.774L229.447 136.524L237.215 141.605L241.8 147.867L241.036 152.711L229.065 158.737L213.019 154.956L175.45 145.977L162.587 142.787H160.805V143.85L171.502 154.366L191.242 172.089L215.82 195.011L217.094 200.682L213.91 205.172L210.599 204.699L188.949 188.394L180.544 181.069L161.696 165.118H160.422V166.772L164.752 173.152L187.803 207.771L188.949 218.405L187.294 221.832L181.308 223.959L174.813 222.777L161.187 203.754L147.305 182.486L136.098 163.345L134.745 164.2L128.075 235.42L125.019 239.082L117.887 241.8L111.902 237.31L108.718 229.984L111.902 215.452L115.722 196.547L118.779 181.541L121.58 162.873L123.291 156.636L123.14 156.219L121.773 156.449L107.699 175.752L86.304 204.699L69.3663 222.777L65.291 224.431L58.2867 220.768L58.9235 214.27L62.8713 208.48L86.304 178.705L100.44 160.155L109.551 149.507L109.462 147.967L108.959 147.924L46.6977 188.512L35.6182 189.93L30.7788 185.44L31.4156 178.115L33.7079 175.752L52.4285 162.873Z" fill="#D97757"/></svg>`,
  chatgpt: `<svg width="100%" height="100%" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M9.20509 8.76511V6.50545C9.20509 6.31513 9.27649 6.17234 9.44293 6.0773L13.9861 3.46088C14.6046 3.10413 15.342 2.93769 16.103 2.93769C18.9573 2.93769 20.7651 5.14983 20.7651 7.50454C20.7651 7.67098 20.7651 7.86129 20.7412 8.05161L16.0316 5.2924C15.7462 5.12596 15.4607 5.12596 15.1753 5.2924L9.20509 8.76511ZM19.8135 17.5659V12.1664C19.8135 11.8333 19.6708 11.5955 19.3854 11.429L13.4152 7.95633L15.3656 6.83833C15.5321 6.74328 15.6749 6.74328 15.8413 6.83833L20.3845 9.45474C21.6928 10.216 22.5728 11.8333 22.5728 13.4031C22.5728 15.2108 21.5025 16.8758 19.8135 17.5657V17.5659ZM7.80173 12.8088L5.8513 11.6671C5.68486 11.5721 5.61346 11.4293 5.61346 11.239V6.00613C5.61346 3.46111 7.56389 1.53433 10.2042 1.53433C11.2033 1.53433 12.1307 1.86743 12.9159 2.46202L8.2301 5.17371C7.94475 5.34015 7.80195 5.57798 7.80195 5.91109V12.809L7.80173 12.8088ZM12 15.2349L9.20509 13.6651V10.3351L12 8.76534L14.7947 10.3351V13.6651L12 15.2349ZM13.7958 22.4659C12.7967 22.4659 11.8693 22.1328 11.0841 21.5382L15.7699 18.8265C16.0553 18.6601 16.198 18.4222 16.198 18.0891V11.1912L18.1723 12.3329C18.3388 12.4279 18.4102 12.5707 18.4102 12.761V17.9939C18.4102 20.5389 16.4359 22.4657 13.7958 22.4657V22.4659ZM8.15848 17.1617L3.61528 14.5452C2.30696 13.784 1.42701 12.1667 1.42701 10.5969C1.42701 8.76534 2.52115 7.12414 4.20987 6.43428V11.8574C4.20987 12.1905 4.35266 12.4284 4.63802 12.5948L10.5846 16.0436L8.63415 17.1617C8.46771 17.2567 8.32492 17.2567 8.15848 17.1617ZM7.897 21.0625C5.20919 21.0625 3.23488 19.0407 3.23488 16.5432C3.23488 16.3529 3.25875 16.1626 3.2824 15.9723L7.96817 18.6839C8.25352 18.8504 8.53911 18.8504 8.82446 18.6839L14.7947 15.2351V17.4948C14.7947 17.6851 14.7233 17.8279 14.5568 17.9229L10.0136 20.5393C9.39518 20.8961 8.6578 21.0625 7.89677 21.0625H7.897ZM13.7958 23.8929C16.6739 23.8929 19.0762 21.8474 19.6235 19.1357C22.2874 18.4459 24 15.9484 24 13.4034C24 11.7383 23.2865 10.121 22.002 8.95542C22.121 8.45588 22.1924 7.95633 22.1924 7.45702C22.1924 4.0557 19.4331 1.51045 16.2458 1.51045C15.6037 1.51045 14.9852 1.60549 14.3668 1.81968C13.2963 0.773071 11.8215 0.107086 10.2042 0.107086C7.32606 0.107086 4.92383 2.15256 4.37653 4.86425C1.7126 5.55411 0 8.05161 0 10.5966C0 12.2617 0.713506 13.879 1.99795 15.0446C1.87904 15.5441 1.80764 16.0436 1.80764 16.543C1.80764 19.9443 4.56685 22.4895 7.75421 22.4895C8.39632 22.4895 9.01478 22.3945 9.63324 22.1803C10.7035 23.2269 12.1783 23.8929 13.7958 23.8929Z" fill="white"></path></svg>`,
  gemini: `<svg width="100%" height="100%" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="gemini-g0" x1="7" x2="11" y1="15.5" y2="12" gradientUnits="userSpaceOnUse"><stop stop-color="#08B962"></stop><stop offset="1" stop-color="#08B962" stop-opacity="0"></stop></linearGradient><linearGradient id="gemini-g1" x1="8" x2="11.5" y1="5.5" y2="11" gradientUnits="userSpaceOnUse"><stop stop-color="#F94543"></stop><stop offset="1" stop-color="#F94543" stop-opacity="0"></stop></linearGradient><linearGradient id="gemini-g2" x1="3.5" x2="17.5" y1="13.5" y2="12" gradientUnits="userSpaceOnUse"><stop stop-color="#FABC12"></stop><stop offset=".46" stop-color="#FABC12" stop-opacity="0"></stop></linearGradient></defs><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="#3186FF"></path><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#gemini-g0)"></path><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#gemini-g1)"></path><path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#gemini-g2)"></path></svg>`,
  antigravity: `<svg width="100%" height="100%" viewBox="0 0 250 250" version="1.2" xmlns="http://www.w3.org/2000/svg"><defs><clipPath id="ag-cp" clipPathUnits="userSpaceOnUse"><path d="m226.57 235.49c13.96 10.47 34.9 3.49 15.71-15.71-57.59-55.82-45.36-209.36-116.89-209.36-71.54 0-59.33 153.54-116.9 209.37-20.94 20.93 1.74 26.16 15.7 15.69 54.08-36.64 50.59-101.19 101.2-101.19 50.59 0 47.1 64.55 101.18 101.2z"/></clipPath><filter id="ag-f1" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="11.6"/></filter><filter id="ag-f2" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="56.3"/></filter><filter id="ag-f3" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="47.8"/></filter><filter id="ag-f4" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="45.4"/></filter><filter id="ag-f5" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="41.2"/></filter><filter id="ag-f6" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="36.8"/></filter><filter id="ag-f7" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="32.9"/></filter><filter id="ag-f8" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="27.8"/></filter><filter id="ag-f9" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="34.4"/></filter></defs><g clip-path="url(#ag-cp)"><path d="m-10.6-41.6c-4.3 37.4 28 71.8 72 76.8 44 5 83.1-21.3 87.3-58.7 4.3-37.4-27.9-71.8-71.9-76.8-44-4.9-83.2 21.3-87.4 58.7z" filter="url(#ag-f1)" fill="#ffe432"/><path d="m159.1 80.7c11 47.5 59.2 76.8 107.7 65.5 48.6-11.2 79-58.8 67.9-106.3-11-47.5-59.3-76.8-107.8-65.5-48.5 11.2-78.9 58.8-67.8 106.3z" filter="url(#ag-f2)" fill="#fc413d"/><path d="m-129.6 112.5c13.9 49 76.7 74.1 140.1 56.1 63.5-18.1 103.6-72.4 89.7-121.4-13.9-49-76.7-74.1-140.1-56-63.5 18-103.6 72.3-89.7 121.3z" filter="url(#ag-f3)" fill="#00b95c"/><path d="m-79.2 153.2c34.9 35.6 95 33.4 134.3-5.1 39.3-38.4 42.8-98.5 7.9-134.2-35-35.6-95.1-33.4-134.4 5.1-39.3 38.4-42.8 98.5-7.9 134.2z" filter="url(#ag-f3)" fill="#00b95c"/><path d="m103.5 287.7c10.8 46.7 56 76.1 101 65.6 45-10.4 72.6-56.7 61.8-103.4-10.9-46.7-56.1-76.1-101.1-65.7-44.9 10.5-72.6 56.8-61.7 103.5z" filter="url(#ag-f4)" fill="#3186ff"/><path d="m26.8-85.3c-22.7 50.6 2.1 111 55.5 135 53.3 24 115 2.4 137.7-48.2 22.7-50.6-2.1-111-55.5-135-53.3-23.9-115-2.3-137.7 48.2z" filter="url(#ag-f5)" fill="#fbbc04"/><path d="m-34 403c-55-21.6 38.9-199.2 62.3-258.7 23.4-59.5 86.9-90.2 141.8-68.6 55 21.5 120.2 140.4 96.8 199.9-23.3 59.5-246 149-300.9 127.4z" filter="url(#ag-f6)" fill="#3186ff"/><path d="m299.1 182c-14.8 17.2-53.2 8.4-85.8-19.6-32.7-28-47.2-64.6-32.5-81.7 14.7-17.2 53.1-8.5 85.8 19.5 32.6 28 47.2 64.6 32.5 81.8z" filter="url(#ag-f7)" fill="#749bff"/><path d="m189.2 94.6c60.5 40.9 130.2 43.6 155.7 6 25.4-37.7-3-101.4-63.5-142.3-60.6-41-130.3-43.7-155.7-6-25.5 37.6 3 101.3 63.5 142.3z" filter="url(#ag-f8)" fill="#fc413d"/><path d="m-9.5 28c-15 36.1-10.1 72.5 10.9 81.3 21 8.7 50.3-13.6 65.3-49.8 15-36.1 10.1-72.5-11-81.3-21-8.7-50.2 13.6-65.2 49.8z" filter="url(#ag-f9)" fill="#ffee48"/></g></svg>`
};

// Site Logo Renderer with Fallback (Part C)
function renderSiteLogo(containerEl, siteConfig, siteLower, fallbackBg, fallbackInitial, isSmall = false) {
  if (!containerEl) return;
  containerEl.innerHTML = '';
  containerEl.style.backgroundColor = 'transparent';

  const siteKey = (siteLower || '').toLowerCase();
  const embedded = EMBEDDED_LOGOS[siteKey];

  if (embedded) {
    const wrap = document.createElement('div');
    wrap.className = isSmall ? 'history-site-logo' : 'pill-logo-img';
    if (siteConfig?.tint === 'white' || siteKey === 'chatgpt') {
      wrap.classList.add('tint-white');
    }
    wrap.innerHTML = embedded;
    containerEl.appendChild(wrap);
    return;
  }

  const logoPath = siteConfig?.logo;
  if (logoPath) {
    const img = document.createElement('img');
    img.src = logoPath;
    img.alt = siteConfig?.label || siteLower;
    img.className = isSmall ? 'history-site-logo' : 'pill-logo-img';
    if (siteConfig?.tint === 'white') {
      img.classList.add('tint-white');
    }
    img.onerror = () => {
      renderFallbackLetter(containerEl, fallbackBg, fallbackInitial, isSmall);
    };
    containerEl.appendChild(img);
    return;
  }

  renderFallbackLetter(containerEl, fallbackBg, fallbackInitial, isSmall);
}

function renderFallbackLetter(containerEl, bg, initial, isSmall = false) {
  if (!containerEl) return;
  containerEl.innerHTML = '';
  if (isSmall) {
    const dot = document.createElement('span');
    dot.className = 'history-site-badge-fallback';
    dot.style.backgroundColor = bg;
    containerEl.appendChild(dot);
  } else {
    containerEl.style.backgroundColor = 'transparent';
    const circle = document.createElement('div');
    circle.className = 'pill-logo-fallback';
    circle.style.backgroundColor = bg;
    circle.textContent = initial;
    containerEl.appendChild(circle);
  }
}

function showPopup(type, siteLower, message, tabId, windowId, notifConfig, historyId, targetState, source = 'web', taskId = null) {
  isPillActive = true;
  currentActivePill = { site: siteLower, source, tabId, windowId, historyId, targetState, taskId };

  if (pillHoldTimer) {
    clearTimeout(pillHoldTimer);
    pillHoldTimer = null;
  }
  if (pillShrinkTimer) {
    clearTimeout(pillShrinkTimer);
    pillShrinkTimer = null;
  }

  // Ensure active monitor
  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.invoke) {
    window.__TAURI__.core.invoke('ensure_active_monitor').catch(() => {});
  }

  // Sound playback (skipped if muted or DND active or fullscreen without breakthrough)
  if (window.islandSound && !isDndActive) {
    if (notifConfig.sound === 'tick') {
      window.islandSound.playTick();
    } else if (notifConfig.sound === 'twoTone') {
      window.islandSound.playTwoTone();
    }
  }

  // Site icon logo rendering with fallback (Part C)
  const siteConfig = appConfig?.sites?.[siteLower];
  const siteColors = appConfig?.siteIcons || {
    claude: '#ff7a00',
    chatgpt: '#ff4081',
    gemini: '#9c27b0',
    antigravity: '#00bcd4'
  };
  const iconBg = siteConfig?.color || siteColors[siteLower] || '#757575';
  const initial = siteConfig?.icon || (siteLower ? siteLower.charAt(0).toUpperCase() : '?');

  renderSiteLogo(pillIconEl, siteConfig, siteLower, iconBg, initial, false);
  pillTextEl.textContent = message || '';

  // Type accent & glow styling
  const root = document.documentElement;
  const accentColor = notifConfig.color || '#4caf50';
  root.style.setProperty('--type-accent-color', accentColor);

  let borderTop = 'rgba(255, 255, 255, 0.95)';
  let glowTighter = 'rgba(76, 175, 80, 0.85)';
  let glowWider = 'rgba(76, 175, 80, 0.45)';

  if (type === 'finished') {
    borderTop = 'rgba(255, 255, 255, 0.95)';
    glowTighter = 'rgba(76, 175, 80, 0.85)';
    glowWider = 'rgba(76, 175, 80, 0.45)';
  } else if (type === 'stopped' || type === 'limit_reached') {
    borderTop = 'rgba(255, 255, 255, 0.95)';
    glowTighter = 'rgba(244, 67, 54, 0.85)';
    glowWider = 'rgba(244, 67, 54, 0.45)';
  } else if (type === 'needs_input') {
    borderTop = 'rgba(255, 255, 255, 0.95)';
    glowTighter = 'rgba(255, 122, 0, 0.9)';
    glowWider = 'rgba(255, 122, 0, 0.5)';
  } else if (type === 'working') {
    borderTop = 'rgba(255, 255, 255, 0.95)';
    glowTighter = 'rgba(33, 150, 243, 0.85)';
    glowWider = 'rgba(33, 150, 243, 0.45)';
  }

  root.style.setProperty('--type-border-top', borderTop);
  root.style.setProperty('--type-glow-tighter', glowTighter);
  root.style.setProperty('--type-glow-wider', glowWider);

  // Pulse & type icon classes
  if (notifConfig.pulse) {
    pillEl.classList.add('pulsing');
  } else {
    pillEl.classList.remove('pulsing');
  }

  if (type === 'needs_input' || type === 'limit_reached') {
    pillEl.classList.add('show-type-icon');
  } else {
    pillEl.classList.remove('show-type-icon');
  }

  // Measure start coordinates at target dot
  const offset = measureDotOffset(targetState);
  root.style.setProperty('--pill-offset-x', `${offset.x.toFixed(1)}px`);
  root.style.setProperty('--pill-offset-y', `${offset.y.toFixed(1)}px`);

  // Ensure clean state before expanding
  pillEl.classList.remove('shrinking', 'content-faded');
  void pillEl.offsetHeight; // force reflow

  // Fade out idle dots row and expand pill
  dotsContainer.classList.add('hidden');
  pillEl.classList.add('open');

  const holdDuration = notifConfig.holdDurationMs || 2000;
  pillHoldTimer = setTimeout(() => {
    dismissPill(targetState);
  }, holdDuration);
}

function dismissPill(targetState) {
  if (pillHoldTimer) {
    clearTimeout(pillHoldTimer);
    pillHoldTimer = null;
  }
  if (pillShrinkTimer) {
    clearTimeout(pillShrinkTimer);
    pillShrinkTimer = null;
  }

  const textFadeOutMs = appConfig?.pill?.textFadeOutMs || 250;
  const shrinkDurationMs = appConfig?.pill?.shrinkDurationMs || 900;
  const queuePauseMs = appConfig?.pill?.queuePauseMs || 200;

  // 1. Text fades out first (~250ms)
  pillEl.classList.add('content-faded');

  setTimeout(() => {
    // 2. Measure target dot position when shrink starts
    dotsContainer.classList.remove('hidden');

    const offset = measureDotOffset(targetState);
    const root = document.documentElement;
    root.style.setProperty('--pill-offset-x', `${offset.x.toFixed(1)}px`);
    root.style.setProperty('--pill-offset-y', `${offset.y.toFixed(1)}px`);

    // 3. Pill shrinks back into that state's dot (~900ms)
    pillEl.classList.remove('open');
    pillEl.classList.add('shrinking');

    pillShrinkTimer = setTimeout(() => {
      pillEl.classList.remove('shrinking', 'pulsing', 'show-type-icon', 'content-faded');
      isPillActive = false;
      currentActivePill = null;

      // 4. Queue pause (~200ms) before next notification
      setTimeout(() => {
        if (notificationQueue.length > 0) {
          const next = notificationQueue.shift();
          const currentDistinct = getActiveDistinctStates();
          const isNextNew = next.targetState && !currentDistinct.includes(next.targetState);
          if (isNextNew) {
            renderDots(next.targetState);
            const dotIntro = appConfig?.pill?.dotIntroDurationMs || 300;
            const dotPause = appConfig?.pill?.dotPauseMs || 150;
            setTimeout(() => {
              showPopup(next.type, next.site, next.message, next.tabId, next.windowId, next.notifConfig, next.historyId, next.targetState, next.source, next.taskId);
            }, dotIntro + dotPause);
          } else {
            showPopup(next.type, next.site, next.message, next.tabId, next.windowId, next.notifConfig, next.historyId, next.targetState, next.source, next.taskId);
          }
        }
      }, queuePauseMs);
    }, shrinkDurationMs);
  }, textFadeOutMs);
}

function resolveNeedsInput(site = null, taskId = null) {
  const siteLower = site ? site.toLowerCase() : null;
  const tid = (typeof taskId === 'string' && taskId.trim().length > 0) ? taskId.trim() : null;

  if (siteLower && siteTasks[siteLower]) {
    if (tid && siteTasks[siteLower][tid]) {
      siteTasks[siteLower][tid] = 'none';
    } else {
      Object.keys(siteTasks[siteLower]).forEach(t => {
        if (siteTasks[siteLower][t] === 'needs_input') {
          siteTasks[siteLower][t] = 'none';
        }
      });
    }
    siteStates[siteLower] = computeAggregateSiteState(siteLower);
  } else {
    Object.keys(siteTasks).forEach(s => {
      Object.keys(siteTasks[s]).forEach(t => {
        if (siteTasks[s][t] === 'needs_input') {
          siteTasks[s][t] = 'none';
        }
      });
      siteStates[s] = computeAggregateSiteState(s);
    });
  }
  if (isFullscreenMode) {
    syncFullscreenCycle();
  } else {
    renderDots();
  }
}

// History Store Management with Local Persistence
let historySaveTimer = null;

function saveHistoryDebounced() {
  if (historySaveTimer) clearTimeout(historySaveTimer);
  historySaveTimer = setTimeout(() => {
    historySaveTimer = null;
    try {
      localStorage.setItem('ai_island_history', JSON.stringify(historyStore));
    } catch (_) {}
  }, 300);
}

function loadSavedHistory() {
  try {
    const raw = localStorage.getItem('ai_island_history');
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const maxItems = appConfig?.history?.maxItems || 500;
        historyStore = parsed.slice(0, maxItems);
      }
    }
  } catch (_) {
    historyStore = [];
  }
}

function recordHistory(site, type, message, tabId, windowId, source, taskId = null, taskKind = 'question') {
  const maxItems = appConfig?.history?.maxItems || 500;
  const item = {
    id: Date.now() + Math.random(),
    site: site || 'claude',
    source: source || 'web',
    type,
    taskKind: taskKind || 'question',
    message,
    taskId: (taskId && taskId !== 'default') ? taskId : null,
    tabId: tabId ?? null,
    windowId: windowId ?? null,
    time: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  };
  historyStore.unshift(item);
  if (historyStore.length > maxItems) {
    historyStore.pop();
  }
  saveHistoryDebounced();
  if (isHistoryOpen) {
    renderHistory();
  }
  return item;
}

function removeHistoryItem(id) {
  if (id != null) {
    historyStore = historyStore.filter(i => String(i.id) !== String(id));
    saveHistoryDebounced();
  }
  if (isHistoryOpen) {
    renderHistory();
  }
}

function scheduleHistoryAutoClose() {
  clearHistoryAutoClose();
  if (!isHistoryOpen) return;
  const delaySec = appConfig?.history?.autoCloseDelaySec ?? 3;
  autoCloseTimer = setTimeout(() => {
    if (isHistoryOpen) {
      toggleHistoryPanel();
    }
  }, delaySec * 1000);
}

function clearHistoryAutoClose() {
  if (autoCloseTimer) {
    clearTimeout(autoCloseTimer);
    autoCloseTimer = null;
  }
}

function toggleHistoryPanel() {
  // Never open history panel in fullscreen mode (strict click-through)
  if (isFullscreenMode) return;

  isHistoryOpen = !isHistoryOpen;
  clearHistoryAutoClose();

  if (isHistoryOpen) {
    renderHistory();
    historyPanel.classList.remove('hidden');
    if (window.__TAURI__ && window.__TAURI__.core) {
      window.__TAURI__.core.invoke('set_island_height', { height: 360 }).catch(() => {});
    }
  } else {
    historyPanel.classList.add('hidden');
    if (window.__TAURI__ && window.__TAURI__.core) {
      window.__TAURI__.core.invoke('set_island_height', { height: appConfig?.height || 96 }).catch(() => {});
    }
  }
}

function renderHistory() {
  if (historyStore.length === 0) {
    historyContent.innerHTML = '<div class="history-empty">No notifications</div>';
    return;
  }

  const siteKeys = appConfig?.sites ? Object.keys(appConfig.sites) : ['claude', 'chatgpt', 'gemini', 'antigravity'];
  const allSites = Array.from(new Set([...siteKeys, ...historyStore.map(i => i.site)]));
  const siteColors = appConfig?.siteIcons || {
    claude: '#ff7a00',
    chatgpt: '#ff4081',
    gemini: '#9c27b0',
    antigravity: '#00bcd4'
  };

  let html = '';
  allSites.forEach(site => {
    const items = historyStore.filter(i => i.site === site);
    if (items.length > 0) {
      const siteCfg = appConfig?.sites?.[site];
      const siteName = siteCfg?.label || (site.charAt(0).toUpperCase() + site.slice(1));
      html += `
        <div class="history-group">
          <div class="history-group-title">
            <span class="history-logo-slot" data-site="${site}"></span>
            <span>${siteName} (${items.length})</span>
          </div>
          ${items.map(it => `
            <div class="history-item" data-id="${it.id}">
              <span class="source-tag ${(it.source || 'web').toLowerCase()}">${(it.source || 'web').toUpperCase()}</span>
              <span class="kind-tag">${it.taskKind || 'question'}</span>
              ${it.taskId ? `<span class="task-tag" title="Task: ${it.taskId}">${it.taskId}</span>` : ''}
              <span class="history-item-msg" title="${it.message}">${it.message}</span>
              <span class="history-item-time">${it.time}</span>
            </div>
          `).join('')}
        </div>
      `;
    }
  });

  historyContent.innerHTML = html;

  // Render site logos into history groups
  historyContent.querySelectorAll('.history-logo-slot').forEach(slot => {
    const site = slot.getAttribute('data-site');
    const siteCfg = appConfig?.sites?.[site];
    const badgeColor = siteCfg?.color || siteColors[site] || '#ffffff';
    const initial = siteCfg?.icon || (site ? site.charAt(0).toUpperCase() : '?');
    renderSiteLogo(slot, siteCfg, site, badgeColor, initial, true);
  });

  historyContent.querySelectorAll('.history-item').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = el.getAttribute('data-id');
      const item = historyStore.find(i => String(i.id) === String(id));
      if (!item) return;

      const { site, source, tabId, windowId } = item;
      removeHistoryItem(id);

      if (isHistoryOpen) {
        toggleHistoryPanel();
      }

      if (source === 'desktop' || source === 'ide') {
        if (window.__TAURI__ && window.__TAURI__.core) {
          window.__TAURI__.core.invoke('focus_desktop_app', { appType: site }).catch(err => console.error('[AI Island] focus_desktop_app error:', err));
        }
      } else if (tabId != null && windowId != null && window.__TAURI__ && window.__TAURI__.core) {
        window.__TAURI__.core.invoke('focus_tab', {
          site,
          tabId: Number(tabId),
          windowId: Number(windowId)
        }).catch(err => console.error('[AI Island] focus_tab invoke error:', err));
      }
    });
  });
}

window.addEventListener('DOMContentLoaded', async () => {
  await loadConfig();

  // Clicking dots opens history panel (disabled in fullscreen via pointer-events: none)
  dotsContainer.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleHistoryPanel();
  });

  // Clicking popup pill focuses browser tab / desktop app, removes from history, and shrinks immediately
  pillEl.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!currentActivePill) return;

    const { site, source, tabId, windowId, historyId, targetState } = currentActivePill;
    removeHistoryItem(historyId);

    if (source === 'desktop' || source === 'ide') {
      if (window.__TAURI__ && window.__TAURI__.core) {
        window.__TAURI__.core.invoke('focus_desktop_app', { appType: site }).catch(err => console.error('[AI Island] focus_desktop_app error:', err));
      }
    } else if (tabId != null && windowId != null && window.__TAURI__ && window.__TAURI__.core) {
      window.__TAURI__.core.invoke('focus_tab', {
        site,
        tabId: Number(tabId),
        windowId: Number(windowId)
      }).catch(err => console.error('[AI Island] focus_tab invoke error:', err));
    }

    dismissPill(targetState);
  });

  // History Clear button: sets every site to none, clears history, returns to single white dot
  if (btnClearHistory) {
    btnClearHistory.addEventListener('click', (e) => {
      e.stopPropagation();
      historyStore = [];
      try {
        localStorage.removeItem('ai_island_history');
      } catch (_) {}
      renderHistory();

      Object.keys(siteTasks).forEach(k => {
        siteTasks[k] = {};
      });
      Object.keys(siteStates).forEach(k => {
        siteStates[k] = 'none';
      });

      if (isFullscreenMode) {
        syncFullscreenCycle();
      } else {
        renderDots();
      }
    });
  }

  // Auto-close history panel
  const interactiveElements = [historyPanel, dotsContainer];
  interactiveElements.forEach(el => {
    el.addEventListener('mouseenter', () => {
      clearHistoryAutoClose();
    });
    el.addEventListener('mouseleave', () => {
      if (isHistoryOpen) {
        scheduleHistoryAutoClose();
      }
    });
  });

  // Global listeners for Tauri events
  if (window.__TAURI__ && window.__TAURI__.event) {
    window.__TAURI__.event.listen('island-notification-event', (event) => {
      const payload = event.payload || {};
      handleNotification(payload.type, payload.site, payload.message, payload.tabId, payload.windowId, payload.source, payload.taskId, payload.taskKind);
    });

    window.__TAURI__.event.listen('island-resolve-needs-input', (event) => {
      const payload = event.payload || {};
      resolveNeedsInput(payload.site || null, payload.taskId || null);
    });

    window.__TAURI__.event.listen('island-toggle-dnd', (event) => {
      const payload = event.payload || {};
      isDndActive = Boolean(payload.enabled);
    });

    window.__TAURI__.event.listen('fullscreen-state-change', (event) => {
      const payload = event.payload || {};
      setFullscreenMode(Boolean(payload.isFullscreen));
    });

    window.__TAURI__.event.listen('island-simulate-fullscreen', (event) => {
      const payload = event.payload || {};
      setFullscreenMode(Boolean(payload.enabled));
    });

    window.__TAURI__.event.listen('island-request-fullscreen-status', () => {
      updateFullscreenStatus(fullscreenPhase, fullscreenSecondsLeft);
    });

    window.__TAURI__.event.listen('island-clear-all-states', () => {
      historyStore = [];
      try {
        localStorage.removeItem('ai_island_history');
      } catch (_) {}
      renderHistory();
      Object.keys(siteTasks).forEach(k => {
        siteTasks[k] = {};
      });
      Object.keys(siteStates).forEach(k => {
        siteStates[k] = 'none';
      });
      if (isFullscreenMode) {
        syncFullscreenCycle();
      } else {
        renderDots();
      }
    });

    window.__TAURI__.event.listen('island-sound-mute', (event) => {
      const payload = event.payload || {};
      if (window.islandSound) {
        window.islandSound.setMuted(Boolean(payload.muted));
      }
    });

    window.__TAURI__.event.listen('context-changed', (event) => {
      const payload = event.payload || {};
      setContextMode(payload.context || 'none');
    });

    window.__TAURI__.event.listen('island-simulate-context', (event) => {
      const payload = event.payload || {};
      setContextMode(payload.context || 'none');
    });

    window.__TAURI__.event.listen('island-toggle-history', () => {
      toggleHistoryPanel();
    });
  }
});
