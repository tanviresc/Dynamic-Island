const tokenInput = document.getElementById('token-input');
const btnToggleVisibility = document.getElementById('btn-toggle-visibility');
const btnSave = document.getElementById('btn-save');
const btnTest = document.getElementById('btn-test');
const statusBadge = document.getElementById('status-badge');
const saveFeedback = document.getElementById('save-feedback');
const testFeedback = document.getElementById('test-feedback');

function updateStatusUI(status) {
  statusBadge.className = 'badge';

  if (status === 'connected') {
    statusBadge.textContent = 'Connected';
    statusBadge.classList.add('badge-green');
    btnTest.disabled = false;
  } else if (status === 'disconnected') {
    statusBadge.textContent = 'Disconnected';
    statusBadge.classList.add('badge-red');
    btnTest.disabled = true;
  } else {
    statusBadge.textContent = 'No token';
    statusBadge.classList.add('badge-gray');
    btnTest.disabled = true;
  }
}

async function init() {
  // 1. Load saved token
  const data = await chrome.storage.local.get(['token']);
  if (data.token) {
    tokenInput.value = data.token;
  }

  // 2. Query initial status from background
  try {
    const res = await chrome.runtime.sendMessage({ kind: 'get_status' });
    if (res && res.status) {
      updateStatusUI(res.status);
    }
  } catch (err) {
    updateStatusUI('disconnected');
  }

  // 3. Listen for status changes from background
  chrome.runtime.onMessage.addListener((message) => {
    if (message && message.kind === 'status_changed') {
      updateStatusUI(message.status);
    }
  });

  // 4. Toggle token password visibility
  btnToggleVisibility.addEventListener('click', () => {
    if (tokenInput.type === 'password') {
      tokenInput.type = 'text';
      btnToggleVisibility.textContent = '🔒';
    } else {
      tokenInput.type = 'password';
      btnToggleVisibility.textContent = '👁';
    }
  });

  // 5. Save Token handler
  btnSave.addEventListener('click', async () => {
    const token = tokenInput.value.trim();

    if (!token) {
      await chrome.storage.local.remove(['token']);
      showFeedback(saveFeedback, 'Token removed', '#a1a1aa');
      updateStatusUI('no_token');
      return;
    }

    await chrome.storage.local.set({ token });
    showFeedback(saveFeedback, 'Token saved!', '#4caf50');

    // Trigger immediate reconnect in background
    try {
      await chrome.runtime.sendMessage({ kind: 'reconnect_now' });
    } catch (e) {}

    // Check status after 300ms
    setTimeout(async () => {
      try {
        const res = await chrome.runtime.sendMessage({ kind: 'get_status' });
        if (res && res.status) updateStatusUI(res.status);
      } catch (e) {}
    }, 300);
  });

  // Poll status while popup is open
  setInterval(async () => {
    try {
      const res = await chrome.runtime.sendMessage({ kind: 'get_status' });
      if (res && res.status) updateStatusUI(res.status);
    } catch (e) {}
  }, 1000);

  // 6. Send Test Event handler
  btnTest.addEventListener('click', async () => {
    btnTest.disabled = true;
    showFeedback(testFeedback, 'Sending test notification...', '#a1a1aa');

    try {
      const res = await chrome.runtime.sendMessage({ kind: 'send_test' });
      if (res && res.success) {
        showFeedback(testFeedback, '✓ Sent "Finished" event to island!', '#4caf50');
      } else {
        showFeedback(testFeedback, `Failed: ${res?.error || 'Unknown error'}`, '#f44336');
      }
    } catch (err) {
      showFeedback(testFeedback, 'Error communicating with background worker', '#f44336');
    } finally {
      setTimeout(() => {
        btnTest.disabled = false;
      }, 1000);
    }
  });
}

function showFeedback(el, text, color) {
  el.textContent = text;
  el.style.color = color;
  el.style.opacity = '1';
  setTimeout(() => {
    el.style.opacity = '0';
  }, 2500);
}

document.addEventListener('DOMContentLoaded', init);

