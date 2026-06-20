const DEFAULT_APP_URL = "http://localhost:3000";
const POLL_INTERVAL_MS = 2000;
const activeTasks = new Set();

async function getConfig() {
  const stored = await chrome.storage.sync.get({
    appUrl: DEFAULT_APP_URL,
    token: ""
  });

  return {
    appUrl: String(stored.appUrl || DEFAULT_APP_URL).replace(/\/$/, ""),
    token: String(stored.token || "")
  };
}

async function postToApp(action, payload = {}) {
  const config = await getConfig();
  if (!config.token) {
    return { success: false, error: "Configure o token da extensao." };
  }

  const response = await fetch(`${config.appUrl}/api/flow/extension`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action,
      token: config.token,
      ...payload
    })
  });

  return response.json();
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForTabLoad(tabId, timeoutMs) {
  const start = Date.now();

  while (Date.now() - start < timeoutMs) {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) {
      throw new Error("A aba da tarefa foi fechada.");
    }

    if (tab.status === "complete") {
      return;
    }

    await delay(500);
  }
}

async function sendTaskToTab(tabId, task) {
  const config = await getConfig();
  try {
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["content.js"]
    });
  } catch {
    // The content script may already be present through manifest matches.
  }

  return chrome.tabs.sendMessage(tabId, {
    source: "mrchicken",
    appUrl: config.appUrl,
    token: config.token,
    task
  });
}

async function runTask(task) {
  if (activeTasks.has(task.id)) {
    return;
  }

  activeTasks.add(task.id);

  try {
    const tab = await chrome.tabs.create({
      url: task.url,
      active: true
    });

    if (!tab.id) {
      throw new Error("Chrome nao retornou o ID da nova aba.");
    }

    await waitForTabLoad(tab.id, Math.min(task.timeoutMs || 300000, 60000));
    const response = await sendTaskToTab(tab.id, task);

    if (response?.status === "accepted") {
      activeTasks.add(`${task.id}:accepted`);
      return;
    }

    await postToApp("result", {
      taskId: task.id,
      status: "failed",
      error: response?.error || "Tarefa da extensao nao foi aceita."
    });
  } catch (err) {
    await postToApp("result", {
      taskId: task.id,
      status: "failed",
      error: err instanceof Error ? err.message : String(err)
    });
  } finally {
    if (!activeTasks.has(`${task.id}:accepted`)) {
      activeTasks.delete(task.id);
    }
  }
}

async function poll() {
  try {
    const response = await postToApp("poll");
    if (response?.success && response.task) {
      void runTask(response.task);
    }
  } catch {
    // Keep polling quiet while the local app is offline.
  }
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const len = bytes.byteLength;
  const chunkSize = 8192;
  for (let i = 0; i < len; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }
  return btoa(binary);
}

async function fetchUrlAsDataUrl(url, timeoutMs) {
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const blob = await response.blob();
    const buffer = await blob.arrayBuffer();
    const base64 = arrayBufferToBase64(buffer);
    return `data:${blob.type || "application/octet-stream"};base64,${base64}`;
  } finally {
    clearTimeout(abort);
  }
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.source !== "mrchicken-content") {
    return false;
  }

  if (message.type === "fetch_url") {
    fetchUrlAsDataUrl(message.url, message.timeoutMs || 60000)
      .then(dataUrl => sendResponse({ success: true, dataUrl }))
      .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
    return true;
  }

  if (message.type === "waiting_manual_verification") {
    postToApp("waiting_manual_verification", {
      taskId: message.taskId,
      message: message.message
    }).then(sendResponse);
    return true;
  }

  if (message.type === "task_result") {
    postToApp("result", {
      taskId: message.taskId,
      status: message.status,
      result: message.result || {},
      error: message.error
    }).then(result => {
      activeTasks.delete(message.taskId);
      activeTasks.delete(`${message.taskId}:accepted`);
      sendResponse(result);
    });
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create("mrchicken-poll", { periodInMinutes: 0.1 });
  void postToApp("heartbeat");
  void poll();
});

chrome.runtime.onStartup.addListener(() => {
  chrome.alarms.create("mrchicken-poll", { periodInMinutes: 0.1 });
  void postToApp("heartbeat");
  void poll();
});

chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === "mrchicken-poll") {
    void poll();
  }
});

setInterval(() => {
  void poll();
}, POLL_INTERVAL_MS);

void postToApp("heartbeat");
void poll();
