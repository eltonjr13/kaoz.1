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
      extensionVersion: chrome.runtime.getManifest().version,
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

async function createTaskTab(task) {
  const tab = await chrome.tabs.create({
    url: task.url,
    active: true
  });

  if (!tab.id) {
    throw new Error("Chrome nao retornou o ID da nova aba.");
  }

  await waitForTabLoad(tab.id, Math.min(task.timeoutMs || 300000, 60000));
  return tab;
}

async function postTaskFailure(taskId, error) {
  await postToApp("result", {
    taskId,
    status: "failed",
    error
  });
}

async function runTask(task) {
  if (activeTasks.has(task.id)) {
    return;
  }

  activeTasks.add(task.id);

  try {
    const tab = await createTaskTab(task);
    const response = await sendTaskToTab(tab.id, task);

    if (response?.status === "accepted") {
      activeTasks.add(`${task.id}:accepted`);
      return;
    }

    await postTaskFailure(task.id, response?.error || "Tarefa da extensao nao foi aceita.");
  } catch (err) {
    await postTaskFailure(task.id, err instanceof Error ? err.message : String(err));
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

async function withDebugger(tabId, action) {
  const target = { tabId };
  await chrome.debugger.attach(target, "1.3");
  try {
    return await action(target);
  } finally {
    await chrome.debugger.detach(target).catch(() => undefined);
  }
}

async function setFileInputFiles(tabId, selector, filePath) {
  return withDebugger(tabId, async target => {
    const documentNode = await chrome.debugger.sendCommand(target, "DOM.getDocument", {
      depth: -1,
      pierce: true
    });
    const match = await chrome.debugger.sendCommand(target, "DOM.querySelector", {
      nodeId: documentNode.root.nodeId,
      selector
    });

    if (!match.nodeId) {
      throw new Error("Input de arquivo marcado nao foi encontrado pelo Chrome Debugger.");
    }

    await chrome.debugger.sendCommand(target, "DOM.setFileInputFiles", {
      nodeId: match.nodeId,
      files: [filePath]
    });

    return { success: true };
  });
}

function handleFetchUrl(message, _sender, sendResponse) {
  fetchUrlAsDataUrl(message.url, message.timeoutMs || 60000)
    .then(dataUrl => sendResponse({ success: true, dataUrl }))
    .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
  return true;
}

function handleSetFileInputFiles(message, sender, sendResponse) {
  const tabId = sender.tab?.id;
  if (!tabId) {
    sendResponse({ success: false, error: "Aba da tarefa nao identificada para upload via debugger." });
    return false;
  }

  setFileInputFiles(tabId, message.selector, message.filePath)
    .then(result => sendResponse(result))
    .catch(err => sendResponse({ success: false, error: err.message || String(err) }));
  return true;
}

function handleWaitingManualVerification(message, _sender, sendResponse) {
  postToApp("waiting_manual_verification", {
    taskId: message.taskId,
    message: message.message
  }).then(sendResponse);
  return true;
}

function handleFlowTrace(message, _sender, sendResponse) {
  postToApp("trace", {
    taskId: message.taskId,
    step: message.step,
    detail: message.detail,
    trace: message.trace
  }).then(sendResponse);
  return true;
}

function handleTaskResult(message, _sender, sendResponse) {
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

const contentMessageHandlers = {
  fetch_url: handleFetchUrl,
  set_file_input_files: handleSetFileInputFiles,
  waiting_manual_verification: handleWaitingManualVerification,
  flow_trace: handleFlowTrace,
  task_result: handleTaskResult
};

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.source !== "mrchicken-content") {
    return false;
  }

  const handler = contentMessageHandlers[message.type];
  return handler ? handler(message, sender, sendResponse) : false;
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
