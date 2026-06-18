const LOGIN_URL_PATTERNS = [
  "accounts.google.com",
  "signin",
  "sign_in",
  "sign-in",
  "/login",
  "/auth",
  "/signup",
  "sign-up"
];

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function visible(element) {
  if (!element) return false;
  const style = window.getComputedStyle(element);
  const rect = element.getBoundingClientRect();
  return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
}

function byText(pattern, selectors = "button,a,div,span") {
  const regex = pattern instanceof RegExp ? pattern : new RegExp(pattern, "i");
  return Array.from(document.querySelectorAll(selectors)).find(element =>
    visible(element) && regex.test((element.textContent || "").trim())
  );
}

async function waitFor(condition, timeoutMs, intervalMs = 750) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await condition();
    if (result) return result;
    await delay(intervalMs);
  }
  return null;
}

function hasCloudflareChallenge() {
  const url = window.location.href.toLowerCase();
  if (url.includes("cloudflare") || url.includes("challenge") || url.includes("turnstile")) {
    return true;
  }

  const bodyText = document.body?.innerText || "";
  if (/verify you are human|checking your browser|confirme que .+ humano|cloudflare|turnstile/i.test(bodyText)) {
    return true;
  }

  return !!document.querySelector('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], input[name="cf-turnstile-response"]');
}

function isLoginUrl() {
  const url = window.location.href.toLowerCase();
  return LOGIN_URL_PATTERNS.some(pattern => url.includes(pattern));
}

async function notifyWaiting(taskId, message) {
  try {
    await chrome.runtime.sendMessage({
      source: "mrchicken-content",
      type: "waiting_manual_verification",
      taskId,
      message
    });
  } catch {
    // Background may be sleeping; the task will still continue locally.
  }
}

async function notifyTaskResult(taskId, response) {
  await chrome.runtime.sendMessage({
    source: "mrchicken-content",
    type: "task_result",
    taskId,
    status: response?.status || "failed",
    result: response?.result || {},
    error: response?.error
  });
}

async function waitForManualVerification(task) {
  if (!hasCloudflareChallenge()) {
    return true;
  }

  await notifyWaiting(
    task.id,
    "Cloudflare/Turnstile detectado. Resolva a verificacao manualmente nesta aba para a automacao continuar."
  );

  const cleared = await waitFor(() => !hasCloudflareChallenge(), task.timeoutMs || 300000, 1500);
  return !!cleared;
}

async function waitForManualLogin(task) {
  await waitForManualVerification(task);

  const authenticated = await waitFor(async () => {
    if (hasCloudflareChallenge()) {
      await waitForManualVerification(task);
      return false;
    }
    return isAuthenticated(task.portal);
  }, task.timeoutMs || 300000, 1500);

  return !!authenticated;
}

function setEditableValue(element, value) {
  element.focus();

  if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
    element.value = "";
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    return;
  }

  document.execCommand("selectAll", false);
  document.execCommand("delete", false);
  element.textContent = value;
  element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
}

async function clickCandidate(selectors, textPattern) {
  for (const selector of selectors) {
    const element = Array.from(document.querySelectorAll(selector)).find(visible);
    if (element) {
      element.click();
      return true;
    }
  }

  if (textPattern) {
    const element = byText(textPattern);
    if (element) {
      element.click();
      return true;
    }
  }

  return false;
}

function portalInputSelectors(portal) {
  if (portal === "gemini") {
    return ['div[role="textbox"]', 'div[contenteditable="true"]', '[contenteditable="true"]', "textarea"];
  }
  if (portal === "chatgpt") {
    return ["#prompt-textarea", "textarea", 'div[contenteditable="true"]'];
  }
  if (portal === "claude") {
    return ['div[contenteditable="true"]', '[contenteditable="true"]', "textarea"];
  }
  if (portal === "deepseek") {
    return ["#chat-input", "textarea", 'div[contenteditable="true"]'];
  }
  return ['div[contenteditable="true"]', '[role="textbox"]', "textarea"];
}

async function findInput(portal, timeoutMs) {
  return waitFor(() => {
    for (const selector of portalInputSelectors(portal)) {
      const element = Array.from(document.querySelectorAll(selector)).find(visible);
      if (element) return element;
    }
    return null;
  }, timeoutMs);
}

async function sendPrompt(portal, prompt, timeoutMs) {
  const input = await findInput(portal, timeoutMs);
  if (!input) {
    throw new Error(`Campo de prompt nao encontrado em ${portal}.`);
  }

  setEditableValue(input, prompt);
  await delay(500);

  const clicked = await clickCandidate(
    [
      'button[data-testid="send-button"]',
      'button[aria-label*="Send"]',
      'button[aria-label*="Enviar"]',
      'button[aria-label*="Generate"]',
      'button[aria-label*="Gerar"]',
      'button[type="submit"]',
      'div[role="button"].ds-button--circle',
      ".send-btn"
    ],
    /Send|Enviar|Generate|Gerar|Criar|Create|arrow_forward/i
  );

  if (!clicked) {
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", bubbles: true }));
  }
}

function normalizeResponseText(text) {
  return String(text || "")
    .replace(/\s+/g, " ")
    .trim();
}

function elementText(element) {
  const clone = element.cloneNode(true);
  clone.querySelectorAll("button, svg, nav, menu").forEach(child => child.remove());
  return (clone.textContent || "").trim();
}

function claudeAssistantTexts() {
  const preferredSelectors = [
    '[data-testid="assistant-message"]',
    '[data-message-author-role="assistant"]',
    ".font-claude-message",
    'div[class*="font-claude-message"]',
    'div[class*="prose"]'
  ];

  const preferred = preferredSelectors
    .flatMap(selector => Array.from(document.querySelectorAll(selector)))
    .filter(visible)
    .map(elementText)
    .filter(text => text.length > 15);

  if (preferred.length > 0) {
    return preferred;
  }

  return Array.from(document.querySelectorAll("article"))
    .filter(visible)
    .map(elementText)
    .filter(text =>
      text.length > 15 &&
      !/Melhore o seguinte prompt|Retorne apenas o prompt|sem comentarios adicionais|sem comentários adicionais/i.test(text)
    );
}

function assistantTexts(portal) {
  if (portal === "claude") {
    return claudeAssistantTexts();
  }

  const selectors =
    portal === "gemini"
      ? [".message-content", ".response-container", 'div[role="log"] div']
      : portal === "chatgpt"
        ? ['div[data-message-author-role="assistant"]', ".markdown"]
        : [".ds-markdown", ".assistant-msg", ".chat-message"];

  return selectors
    .flatMap(selector => Array.from(document.querySelectorAll(selector)))
    .filter(visible)
    .map(elementText)
    .filter(text => text.length > 15);
}

function assistantText(portal) {
  const texts = assistantTexts(portal);
  return texts[texts.length - 1] || "";
}

async function waitForAssistantText(portal, timeoutMs, previousText, submittedPrompt) {
  let lastText = "";
  let stableCount = 0;
  const previousNormalized = normalizeResponseText(previousText);
  const submittedNormalized = normalizeResponseText(submittedPrompt);

  const text = await waitFor(() => {
    const current = assistantText(portal);
    if (!current) return null;
    const currentNormalized = normalizeResponseText(current);
    if (previousNormalized && currentNormalized === previousNormalized) return null;
    if (submittedNormalized && currentNormalized.includes(submittedNormalized)) return null;
    if (/Melhore o seguinte prompt|Retorne apenas o prompt|sem comentarios adicionais|sem comentários adicionais/i.test(current)) {
      return null;
    }

    if (current === lastText) {
      stableCount++;
    } else {
      stableCount = 0;
      lastText = current;
    }
    return stableCount >= 2 ? current : null;
  }, timeoutMs, 1500);

  if (!text) {
    throw new Error(`Resposta do portal ${portal} nao foi detectada.`);
  }

  return text.trim();
}

function isAuthenticated(portal) {
  if (isLoginUrl()) return false;
  if (hasCloudflareChallenge()) return false;

  if (portal === "google") {
    if (window.location.href.includes("/project/")) return true;
    if (byText(/Novo projeto|New project|Create with Google Flow|Criar com o Google Flow|Create with Flow|Criar com o Flow/i, "button,a,div")) {
      return true;
    }
    return !!document.querySelector('div[contenteditable="true"], [role="textbox"]');
  }

  if (portal === "gemini") {
    return !!document.querySelector('div[contenteditable="true"], div[role="textbox"], textarea');
  }

  if (portal === "chatgpt") {
    return !!document.querySelector("#prompt-textarea, textarea, div[contenteditable='true']");
  }

  if (portal === "claude") {
    return !!document.querySelector("div[contenteditable='true'], textarea");
  }

  if (portal === "deepseek") {
    return !!document.querySelector("#chat-input, textarea");
  }

  return false;
}

async function waitForGoogleFlowPrompt(timeoutMs) {
  return findInput("google", timeoutMs);
}

async function enterGoogleFlowWorkspace(timeoutMs = 30000) {
  const entry = byText(/Create with Google Flow|Criar com o Google Flow|Create with Flow|Criar com o Flow/i, "button,a,div");
  if (entry) {
    entry.click();
    await delay(3000);
  }

  let promptInput = await waitForGoogleFlowPrompt(5000);
  if (promptInput) {
    return promptInput;
  }

  const newProject = byText(/Novo projeto|New project/i, "button,a,div");
  if (newProject) {
    newProject.click();
    await delay(3000);
  }

  promptInput = await waitForGoogleFlowPrompt(timeoutMs);
  if (!promptInput) {
    throw new Error("Campo de prompt nao encontrado em google.");
  }

  return promptInput;
}

async function configureGoogleFlowTask(task) {
  const options = task.payload?.options || {};
  const mediaType = task.type === "generateVideo" ? "video" : "image";

  await enterGoogleFlowWorkspace(Math.min(task.timeoutMs || 300000, 60000));

  if (options.aspectRatio) {
    const ratioButton = byText(new RegExp(String(options.aspectRatio).replace(":", "\\s*:\\s*"), "i"), "button,div,span");
    if (ratioButton) {
      ratioButton.click();
      await delay(400);
    }
  }

  if (options.model) {
    const modelButton = byText(new RegExp(String(options.model), "i"), "button,div,span");
    if (modelButton) {
      modelButton.click();
      await delay(400);
    }
  }

  return mediaType;
}

async function dataUrlFromSource(src, timeoutMs) {
  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(src, { credentials: "include", signal: controller.signal });
    const blob = await response.blob();
    return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ""));
      reader.onerror = () => reject(reader.error || new Error("Falha ao ler midia."));
      reader.readAsDataURL(blob);
    });
  } finally {
    clearTimeout(abort);
  }
}

async function collectGoogleFlowMedia(mediaType, timeoutMs, expectedCount) {
  const selector = mediaType === "video" ? "video" : "img";
  const media = await waitFor(async () => {
    const candidates = Array.from(document.querySelectorAll(selector))
      .filter(visible)
      .map(element => element.currentSrc || element.src)
      .filter(src => src && (/googleusercontent|usercontent\.google|getMediaUrlRedirect|^blob:/i.test(src)));

    const unique = Array.from(new Set(candidates));
    return unique.length >= expectedCount ? unique.slice(-expectedCount) : null;
  }, timeoutMs, 2000);

  if (!media || media.length === 0) {
    throw new Error("Midia gerada nao foi detectada no Google Flow.");
  }

  const converted = [];
  for (const src of media) {
    converted.push(await dataUrlFromSource(src, timeoutMs));
  }
  return converted;
}

function expectedQuantity(options) {
  const quantity = options?.quantity;
  if (typeof quantity === "number") return Math.max(1, Math.min(4, quantity));
  if (typeof quantity === "string") {
    const parsed = Number(quantity.replace(/\D/g, ""));
    if (parsed) return Math.max(1, Math.min(4, parsed));
  }
  return 1;
}

async function handleLoginTask(task) {
  const authenticated = await waitForManualLogin(task);
  if (!authenticated) {
    return {
      status: "timeout",
      error: "Login ou verificacao manual nao concluido dentro do tempo limite."
    };
  }

  return {
    status: "completed",
    result: {
      authenticated: true,
      message: `Login em ${task.portal} detectado pela extensao.`
    }
  };
}

async function handleCheckStatus(task) {
  await waitForManualVerification(task);
  if (task.portal === "google") {
    await enterGoogleFlowWorkspace();
  }

  return {
    status: "completed",
    result: {
      authenticated: isAuthenticated(task.portal)
    }
  };
}

async function handleOptimizePrompt(task) {
  await waitForManualVerification(task);
  if (!isAuthenticated(task.portal)) {
    throw new Error(`Portal ${task.portal} nao autenticado.`);
  }

  const prompt = String(task.payload?.prompt || "");
  const previousText = assistantText(task.portal);
  await sendPrompt(task.portal, prompt, Math.min(task.timeoutMs || 300000, 30000));
  const text = await waitForAssistantText(task.portal, task.timeoutMs || 300000, previousText, prompt);

  return {
    status: "completed",
    result: { text }
  };
}

async function handleGoogleFlowGeneration(task) {
  await waitForManualVerification(task);
  if (!isAuthenticated("google")) {
    throw new Error("Google Flow nao autenticado.");
  }

  const mediaType = await configureGoogleFlowTask(task);
  const prompt = String(task.payload?.prompt || "");
  await sendPrompt("google", prompt, Math.min(task.timeoutMs || 300000, 30000));

  const options = task.payload?.options || {};
  const media = await collectGoogleFlowMedia(
    mediaType,
    task.timeoutMs || 300000,
    expectedQuantity(options)
  );

  return {
    status: "completed",
    result: { media }
  };
}

async function runTask(task) {
  if (!await waitForManualVerification(task)) {
    return {
      status: "timeout",
      error: "Cloudflare/Turnstile nao foi resolvido dentro do tempo limite."
    };
  }

  if (task.type === "loginSession") {
    return handleLoginTask(task);
  }

  if (task.type === "checkStatus") {
    return handleCheckStatus(task);
  }

  if (task.type === "optimizePrompt") {
    return handleOptimizePrompt(task);
  }

  if (task.type === "generateImage" || task.type === "generateVideo") {
    return handleGoogleFlowGeneration(task);
  }

  throw new Error(`Tipo de tarefa nao suportado: ${task.type}`);
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.source !== "mrchicken" || !message.task) {
    return false;
  }

  runTask(message.task)
    .then(response => notifyTaskResult(message.task.id, response))
    .catch(err => {
      return notifyTaskResult(message.task.id, {
        status: "failed",
        error: err instanceof Error ? err.message : String(err)
      });
    });

  sendResponse({ status: "accepted" });
  return false;
});
