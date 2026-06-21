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

const flowTrace = [];
let activeFlowTaskId = null;

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

function traceFlow(step, detail = {}) {
  flowTrace.push({
    step,
    detail,
    at: new Date().toISOString()
  });
  if (flowTrace.length > 40) {
    flowTrace.shift();
  }
  if (activeFlowTaskId) {
    void notifyFlowTrace(activeFlowTaskId, step, detail);
  }
}

function traceSummary() {
  return flowTrace.map(entry => `${entry.step}:${JSON.stringify(entry.detail)}`).join(" | ");
}

function errorWithTrace(err) {
  const message = err instanceof Error ? err.message : String(err);
  const trace = traceSummary();
  return trace ? `${message} [FlowTrace] ${trace}` : message;
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

async function notifyFlowTrace(taskId, step, detail) {
  try {
    await chrome.runtime.sendMessage({
      source: "mrchicken-content",
      type: "flow_trace",
      taskId,
      step,
      detail,
      trace: flowTrace.slice(-12)
    });
  } catch {
    // Trace is diagnostic only; task execution should continue.
  }
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

function normalizeEditableText(text) {
  return String(text || "")
    .replace(/\u200b/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function editableText(element) {
  if (element.tagName === "TEXTAREA" || element.tagName === "INPUT") {
    return normalizeEditableText(element.value);
  }

  return normalizeEditableText(element.innerText || element.textContent || "");
}

function editableContains(element, value) {
  const expected = normalizeEditableText(value);
  return editableText(element).includes(expected.slice(0, Math.min(80, expected.length)));
}

function isTextControl(element) {
  return element.tagName === "TEXTAREA" || element.tagName === "INPUT";
}

function resolveEditableElement(element) {
  if (isTextControl(element) || element.isContentEditable) {
    return element;
  }

  return element.querySelector("[contenteditable]") || element;
}

function dispatchEditableEvents(element, value, inputType = "insertText") {
  try {
    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType,
      data: value
    }));
  } catch {
    element.dispatchEvent(new Event("beforeinput", { bubbles: true, cancelable: true }));
  }

  try {
    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType,
      data: value
    }));
  } catch {
    element.dispatchEvent(new Event("input", { bubbles: true }));
  }

  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent("keyup", { key: " ", code: "Space", bubbles: true }));
}

function setNativeValue(element, value) {
  const prototype = element.tagName === "TEXTAREA"
    ? window.HTMLTextAreaElement.prototype
    : window.HTMLInputElement.prototype;
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

function selectEditableContents(element) {
  const selection = window.getSelection();
  const range = document.createRange();
  range.selectNodeContents(element);
  selection.removeAllRanges();
  selection.addRange(range);
}

function textDataTransfer(value) {
  try {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    return data;
  } catch {
    return null;
  }
}

function dispatchPasteEvents(element, value) {
  const clipboardData = textDataTransfer(value);
  if (!clipboardData) {
    return false;
  }

  let handled = false;
  try {
    const beforeInput = new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "insertFromPaste",
      data: value,
      dataTransfer: clipboardData
    });
    handled = !element.dispatchEvent(beforeInput) || handled;
  } catch {
    // Some browsers do not support dataTransfer on InputEventInit.
  }

  try {
    const paste = new ClipboardEvent("paste", {
      bubbles: true,
      cancelable: true,
      clipboardData
    });
    handled = !element.dispatchEvent(paste) || handled;
  } catch {
    const paste = new Event("paste", { bubbles: true, cancelable: true });
    Object.defineProperty(paste, "clipboardData", { value: clipboardData });
    handled = !element.dispatchEvent(paste) || handled;
  }

  return handled;
}

async function setEditableValue(element, value) {
  const editableEl = resolveEditableElement(element);
  editableEl.click();
  editableEl.focus();

  if (isTextControl(editableEl)) {
    setNativeValue(editableEl, "");
    dispatchEditableEvents(editableEl, "", "deleteContentBackward");
    setNativeValue(editableEl, value);
    dispatchEditableEvents(editableEl, value);
    return editableEl;
  }

  selectEditableContents(editableEl);
  try {
    document.execCommand("delete", false);
  } catch (e) {
    console.error("execCommand delete failed:", e);
  }
  dispatchEditableEvents(editableEl, "", "deleteContentBackward");
  await delay(50);

  selectEditableContents(editableEl);
  dispatchPasteEvents(editableEl, value);
  await delay(100);

  if (!editableContains(editableEl, value)) {
    try {
      document.execCommand("insertText", false, value);
    } catch (e) {
      console.error("execCommand insertText failed:", e);
    }
  }

  dispatchEditableEvents(editableEl, value, "insertFromPaste");
  return editableEl;
}

function assertPromptAccepted(input, prompt) {
  if (!editableContains(input, prompt)) {
    throw new Error("O campo de prompt nao aceitou o texto inserido.");
  }
}

function buttonDisabled(button) {
  return button.disabled ||
    button.getAttribute("aria-disabled") === "true" ||
    button.closest("[aria-disabled='true']");
}

function buttonText(button) {
  return [
    button.textContent || "",
    button.getAttribute("aria-label") || "",
    button.getAttribute("title") || ""
  ].join(" ");
}

function isGoogleFlowSubmitButton(button) {
  const text = buttonText(button);
  return visible(button) &&
    !buttonDisabled(button) &&
    (
      /arrow_forward/i.test(text) ||
      /Gerar|Criar|Generate|Create|Send|Enviar/i.test(text) ||
      button.getAttribute("type") === "submit"
    );
}

function elementCenter(element) {
  const rect = element.getBoundingClientRect();
  return {
    x: rect.left + rect.width / 2,
    y: rect.top + rect.height / 2
  };
}

function distanceBetweenElements(a, b) {
  const aCenter = elementCenter(a);
  const bCenter = elementCenter(b);
  return Math.hypot(aCenter.x - bCenter.x, aCenter.y - bCenter.y);
}

function googleFlowSubmitButton(input) {
  const buttons = Array.from(document.querySelectorAll("button"))
    .filter(isGoogleFlowSubmitButton)
    .sort((a, b) => distanceBetweenElements(a, input) - distanceBetweenElements(b, input));

  return buttons[0] || null;
}

async function clickGoogleFlowSubmit(input, timeoutMs) {
  const submitButton = await waitFor(() => googleFlowSubmitButton(input), timeoutMs, 500);
  if (!submitButton) {
    throw new Error("Botao de gerar do Google Flow nao ficou habilitado apos inserir o prompt.");
  }

  submitButton.click();
  await delay(1000);
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
    return ['[contenteditable]', 'div[role="textbox"]', "textarea"];
  }
  if (portal === "chatgpt") {
    return ["#prompt-textarea", "textarea", '[contenteditable]'];
  }
  if (portal === "claude") {
    return ['[contenteditable]', "textarea"];
  }
  if (portal === "deepseek") {
    return ["#chat-input", "textarea", '[contenteditable]'];
  }
  return ['[contenteditable]', 'div[role="textbox"]', "textarea"];
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
  let input = await findInput(portal, timeoutMs);
  if (!input) {
    throw new Error(`Campo de prompt nao encontrado em ${portal}.`);
  }

  input = await setEditableValue(input, prompt);
  await delay(500);
  assertPromptAccepted(input, prompt);

  if (portal === "google") {
    await clickGoogleFlowSubmit(input, Math.min(timeoutMs, 15000));
    return;
  }

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
    return !!document.querySelector('[contenteditable], [role="textbox"]');
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

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function clickableAncestor(element) {
  return element.closest('button,[role="tab"],[role="menuitem"],[role="option"],[role="menuitemradio"]') || element;
}

function visibleText(element) {
  return normalizeEditableText(element.textContent || "").replace(/\s+/g, "");
}

function visibleByText(pattern, selectors) {
  return Array.from(document.querySelectorAll(selectors)).find(element =>
    visible(element) && pattern.test((element.textContent || "").trim())
  );
}

function clickFlowOption(pattern, selectors = 'button,[role="tab"],[role="menuitem"],[role="option"],[role="menuitemradio"],span,div') {
  const element = visibleByText(pattern, selectors);
  if (!element) return false;
  clickElement(clickableAncestor(element));
  return true;
}

function clickFlowOptionValue(values, selectors = 'button,[role="tab"],span,div') {
  const normalizedValues = values.map(value => String(value).replace(/\s+/g, ""));
  const element = Array.from(document.querySelectorAll(selectors)).find(candidate => {
    if (!visible(candidate)) return false;
    const text = visibleText(candidate);
    return normalizedValues.some(value => text === value || text.includes(value));
  });
  if (!element) return false;
  clickElement(clickableAncestor(element));
  return true;
}

function quantityValues(quantity) {
  if (!quantity) return [];
  const raw = String(quantity).replace(/\s+/g, "");
  const number = raw.replace(/[^\d]/g, "") || "1";
  return number === "1" ? ["1", "1x"] : [number, `x${number}`, `${number}x`];
}

function modelSettingsButton() {
  return visibleByText(/Veo|Banana|Imagen|Image|Imagem|Video|Vídeo/i, "button");
}

async function selectMediaType(mediaType) {
  const pattern = mediaType === "video" ? /Video|Vídeo/i : /Imagem|Image/i;
  if (clickFlowOption(pattern, '[role="tab"],button[role="tab"]')) {
    await delay(700);
  }
}

async function selectAspectRatio(aspectRatio) {
  if (!aspectRatio) return;
  const values = [String(aspectRatio), String(aspectRatio).replace(":", "")];
  if (clickFlowOptionValue(values)) {
    await delay(500);
  }
}

async function selectQuantity(quantity) {
  const values = quantityValues(quantity);
  if (values.length > 0 && clickFlowOptionValue(values)) {
    await delay(500);
  }
}

async function selectModel(model) {
  if (!model) return;
  const modelPattern = new RegExp(escapeRegex(String(model)), "i");
  if (clickFlowOption(modelPattern)) {
    await delay(700);
    return;
  }

  const dropdown = visibleByText(/Veo|Banana|Imagen/i, "button");
  if (dropdown) {
    dropdown.click();
    await delay(700);
  }

  if (clickFlowOption(modelPattern)) {
    await delay(700);
  }
}

function closeFlowMenus() {
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true }));
  document.dispatchEvent(new KeyboardEvent("keyup", { key: "Escape", code: "Escape", bubbles: true }));
}

function clickElement(element) {
  element.scrollIntoView?.({ block: "center", inline: "center" });
  for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click"]) {
    element.dispatchEvent(new MouseEvent(type, {
      bubbles: true,
      cancelable: true,
      view: window
    }));
  }
  element.click?.();
}

async function configureFlowSettings(mediaType, options) {
  const settingsButton = modelSettingsButton();
  if (!settingsButton) {
    return;
  }

  settingsButton.click();
  await delay(1000);
  await selectMediaType(mediaType);
  await selectAspectRatio(options.aspectRatio);
  await selectQuantity(options.quantity);
  await selectModel(options.model);
  closeFlowMenus();
  await delay(500);
}

function parseDataUrl(dataUrl) {
  const matches = String(dataUrl).match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) {
    throw new Error("Imagem de referencia invalida para anexar ao Flow.");
  }
  return { mime: matches[1], base64: matches[2] };
}

function dataUrlToFile(dataUrl, filename) {
  const parsed = parseDataUrl(dataUrl);
  const binary = atob(parsed.base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new File([bytes], filename, { type: parsed.mime });
}

function setFileInput(input, file) {
  const transfer = new DataTransfer();
  transfer.items.add(file);
  input.files = transfer.files;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));
}

async function setFileInputWithDebugger(input, filePath) {
  if (!filePath) {
    return { success: false, error: "Caminho local da imagem nao recebido pela extensao." };
  }

  const marker = `mrchicken-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  input.setAttribute("data-mrchicken-upload-input", marker);
  try {
    const response = await chrome.runtime.sendMessage({
      source: "mrchicken-content",
      type: "set_file_input_files",
      selector: `input[type="file"][data-mrchicken-upload-input="${marker}"]`,
      filePath
    });

    return response || { success: false, error: "Sem resposta do background." };
  } finally {
    input.removeAttribute("data-mrchicken-upload-input");
  }
}

function fileInputDetails(input) {
  const owner = input.closest('[role="dialog"],[role="menu"],[data-state="open"],body');
  return {
    accept: input.getAttribute("accept") || "",
    disabled: input.disabled === true,
    files: input.files?.length || 0,
    inPicker: owner ? /Pesquisar recursos|Search resources|Todas as m[ií]dias|All media/i.test(owner.textContent || "") : false
  };
}

function fileInputCandidates() {
  return Array.from(document.querySelectorAll('input[type="file"]'))
    .filter(input => !input.disabled)
    .map(input => ({ input, details: fileInputDetails(input) }))
    .filter(item => !item.details.accept || /image|\*/i.test(item.details.accept));
}

function bestFileInput() {
  const candidates = fileInputCandidates();
  return candidates.find(item => item.details.inPicker)?.input ||
    candidates[candidates.length - 1]?.input ||
    null;
}

function libraryAddMediaButton() {
  return visibleByText(/Adicionar mídia|Add media/i, "button,[role='button']");
}

function libraryUploadMenuItem() {
  return visibleByText(/Enviar mídia|Upload media/i, "button,[role='menuitem'],div,span");
}

async function openLibraryUploadMode() {
  const addButton = libraryAddMediaButton();
  if (!addButton) {
    return { opened: false, uploadSelected: false };
  }

  clickElement(clickableAncestor(addButton));
  await delay(1000);

  const uploadMenuItem = libraryUploadMenuItem();
  if (uploadMenuItem) {
    clickElement(clickableAncestor(uploadMenuItem));
    await delay(1000);
  }

  return {
    opened: true,
    uploadSelected: !!uploadMenuItem
  };
}

async function findReferenceFileInput(filename) {
  const uploadMode = await openLibraryUploadMode();
  traceFlow("attach:library-upload", uploadMode);
  const fileInput = await waitFor(() => bestFileInput(), 10000, 500);
  traceFlow("attach:file-input-page", {
    found: !!fileInput,
    filename,
    candidates: fileInputCandidates().map(item => item.details)
  });
  if (fileInput) {
    return fileInput;
  }

  const menuOpened = await openPromptMediaMenu();
  traceFlow("attach:menu-fallback", { menuOpened, pickerOpen: resourcePickerOpen() });
  return await waitFor(() => bestFileInput(), 10000, 500);
}

async function setReferenceFileInput(fileInput, options, file) {
  const debuggerUpload = await setFileInputWithDebugger(fileInput, options.referenceImagePath);
  traceFlow("attach:file-set", {
    method: debuggerUpload?.success ? "debugger" : "dataTransfer",
    success: debuggerUpload?.success === true,
    error: debuggerUpload?.error || "",
    filePath: options.referenceImagePath ? "present" : "missing"
  });
  if (!debuggerUpload?.success) {
    setFileInput(fileInput, file);
  }
}

function promptMediaButton() {
  return Array.from(document.querySelectorAll("button")).find(button => {
    const text = button.textContent || "";
    const label = button.getAttribute("aria-label") || "";
    return visible(button) && /add_2|add|media|mídia|midia|upload|attach|anexar/i.test(`${text} ${label}`);
  });
}

async function openPromptMediaMenu() {
  if (resourcePickerOpen()) {
    return true;
  }

  const button = promptMediaButton();
  if (!button) return false;
  clickElement(button);
  await delay(1500);
  return true;
}

function visibleResourceItems() {
  return Array.from(document.querySelectorAll('button,div,[role="option"],[role="menuitem"],[role="listitem"]'))
    .filter(element => {
      const text = normalizeEditableText(element.textContent || "");
      const rect = element.getBoundingClientRect();
      const resourceText = /Imagem|Image|image|ref_image_|avatar_ref_|Falha|Failed|\d{1,3}%/i.test(text);
      const navigationText = /Todas as m[ií]dias|All media|Ver imagens|Pesquisar|Search resources|Ordenar|filter_list|dashboard|arrow_back/i.test(text);
      return visible(element) && resourceText && !navigationText && rect.width >= 40 && rect.height >= 24 && rect.height <= 220;
    });
}

function resourceItemLabels() {
  return visibleResourceItems()
    .slice(0, 8)
    .map(element => normalizeEditableText(element.textContent || "").slice(0, 80));
}

function unusableResourceItem(element) {
  const text = normalizeEditableText(element.textContent || "");
  return /Falha|Failed|warning|delete_forever|Excluir|\d{1,3}%|Uploading|Enviando|Carregando|Processando/i.test(text);
}

function readyResourceItems() {
  return visibleResourceItems().filter(element => !unusableResourceItem(element));
}

function resourceUploadProblemLabels() {
  return visibleResourceItems()
    .filter(unusableResourceItem)
    .slice(0, 5)
    .map(element => normalizeEditableText(element.textContent || "").slice(0, 80));
}

function uploadedReferenceItem(filename) {
  const baseName = String(filename).replace(/\.[^.]+$/, "");
  const filePrefix = baseName.slice(0, Math.min(16, baseName.length));
  return readyResourceItems().find(element => {
    const text = element.textContent || "";
    return text.includes(baseName) ||
      text.includes(filePrefix) ||
      text.includes(filename);
  });
}

function resourceFingerprint(element) {
  const text = normalizeEditableText(element.textContent || "");
  const images = Array.from(element.querySelectorAll("img"))
    .map(img => img.currentSrc || img.src || "")
    .filter(Boolean)
    .slice(0, 3)
    .join("|");
  return `${text}|${images}`;
}

function resourceFingerprints() {
  return new Set(visibleResourceItems().map(resourceFingerprint));
}

function newReadyResourceItem(beforeUpload) {
  return readyResourceItems().find(element => !beforeUpload.has(resourceFingerprint(element)));
}

function includeReferenceButton() {
  const selectors = 'button,[role="button"],div,span';
  const element = visibleByText(/^\s*(Incluir no comando|Include in prompt|Incluir)\s*$/i, selectors) ||
    visibleByText(/Incluir no comando|Include in prompt/i, selectors);
  return element ? clickableAncestor(element) : null;
}

function includeButtonLabels() {
  return Array.from(document.querySelectorAll('button,[role="button"],div,span'))
    .filter(visible)
    .map(element => normalizeEditableText(element.textContent || ""))
    .filter(text => /Incluir|Include|comando|prompt/i.test(text))
    .slice(0, 8);
}

function resourcePickerOpen() {
  return !!visibleByText(/Pesquisar recursos|Search resources|Todas as m[ií]dias|All media/i, "div,span,input");
}

async function includeUploadedReference(filename, beforeUpload, timeoutMs) {
  traceFlow("include:start", { filename, pickerOpen: resourcePickerOpen() });
  const opened = await openPromptMediaMenu();
  traceFlow("include:menu", { opened, pickerOpen: resourcePickerOpen(), items: resourceItemLabels() });
  if (!opened) {
    throw new Error("Menu de recursos do Google Flow nao abriu para anexar a imagem.");
  }

  const item = await waitFor(() => uploadedReferenceItem(filename) || newReadyResourceItem(beforeUpload), timeoutMs, 1000);
  traceFlow("include:item", { found: !!item, items: resourceItemLabels(), problems: resourceUploadProblemLabels() });
  if (!item) {
    const problems = resourceUploadProblemLabels();
    if (problems.length > 0) {
      throw new Error(`Upload da imagem de referencia nao ficou pronto no Google Flow: ${problems.join(" | ")}`);
    }
    throw new Error("Imagem enviada nao foi localizada pronta na lista de recursos do Google Flow.");
  }

  clickElement(clickableAncestor(item));
  await delay(1000);
  traceFlow("include:item-clicked", { pickerOpen: resourcePickerOpen(), includeButtons: includeButtonLabels() });

  if (!resourcePickerOpen()) {
    return;
  }

  const includeButton = await waitFor(() => includeReferenceButton(), 10000, 500);
  traceFlow("include:button", { found: !!includeButton, includeButtons: includeButtonLabels() });
  if (!includeButton) {
    if (!resourcePickerOpen()) {
      return;
    }
    throw new Error("Botao 'Incluir no comando' nao foi encontrado apos selecionar a imagem.");
  }

  clickElement(includeButton);
  const closed = await waitFor(() => !resourcePickerOpen(), 8000, 500);
  traceFlow("include:clicked", { closed, pickerOpen: resourcePickerOpen() });
  if (!closed) {
    closeFlowMenus();
    await delay(1000);
  }

  if (resourcePickerOpen()) {
    throw new Error("A imagem foi selecionada, mas o modal de recursos nao fechou apos clicar em 'Incluir no comando'.");
  }
}

async function attachReferenceImage(options, timeoutMs) {
  if (!options.referenceImage) return;
  const filename = options.referenceImageName || `ref_image_${Date.now()}.png`;
  const file = dataUrlToFile(options.referenceImage, filename);
  const fileInput = await findReferenceFileInput(filename);
  if (!fileInput) {
    throw new Error("Input de upload do Google Flow nao encontrado para anexar a referencia.");
  }

  const beforeUpload = resourceFingerprints();
  await setReferenceFileInput(fileInput, options, file);
  await delay(Math.min(timeoutMs, 5000));
  traceFlow("attach:uploaded", {
    pickerOpen: resourcePickerOpen(),
    items: resourceItemLabels(),
    problems: resourceUploadProblemLabels()
  });
  await includeUploadedReference(filename, beforeUpload, Math.max(timeoutMs - 5000, 45000));
}

async function configureGoogleFlowTask(task) {
  const options = task.payload?.options || {};
  const mediaType = task.type === "generateVideo" ? "video" : "image";

  await enterGoogleFlowWorkspace(Math.min(task.timeoutMs || 300000, 60000));
  await configureFlowSettings(mediaType, options);
  await attachReferenceImage(options, Math.min(task.timeoutMs || 300000, 180000));

  return mediaType;
}

async function dataUrlFromSource(src, timeoutMs) {
  if (!src.startsWith("blob:")) {
    return new Promise((resolve, reject) => {
      chrome.runtime.sendMessage({
        source: "mrchicken-content",
        type: "fetch_url",
        url: src,
        timeoutMs
      }, (response) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(`Erro de comunicacao com a extensao: ${err.message}`));
          return;
        }
        if (response && response.success) {
          resolve(response.dataUrl);
        } else {
          reject(new Error(response?.error || `Falha ao buscar URL remota: ${src}`));
        }
      });
    });
  }

  const controller = new AbortController();
  const abort = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const fetchOptions = { signal: controller.signal };
    const response = await fetch(src, fetchOptions);
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

function flowMediaSelector(mediaType) {
  return mediaType === "video" ? "video" : "img";
}

function mediaSource(element) {
  return element.currentSrc || element.src || element.getAttribute("src") || "";
}

function isFlowMediaSource(src) {
  return !!src && /googleusercontent|usercontent\.google|getMediaUrlRedirect|^blob:/i.test(src);
}

function isLikelyGeneratedMedia(element, mediaType) {
  const src = mediaSource(element);
  if (!isFlowMediaSource(src) || !visible(element)) {
    return false;
  }

  if (mediaType === "video") {
    return true;
  }

  const rect = element.getBoundingClientRect();
  return rect.width >= 96 && rect.height >= 96;
}

function currentFlowMediaSources(mediaType) {
  const selector = flowMediaSelector(mediaType);
  return Array.from(document.querySelectorAll(selector))
    .filter(element => isLikelyGeneratedMedia(element, mediaType))
    .map(mediaSource)
    .filter(Boolean);
}

function flowMediaSnapshot(mediaType) {
  return new Set(currentFlowMediaSources(mediaType));
}

async function collectGoogleFlowMedia(mediaType, timeoutMs, expectedCount, initialSources) {
  const selector = mediaType === "video" ? "video" : "img";
  const media = await waitFor(async () => {
    const candidates = Array.from(document.querySelectorAll(selector))
      .filter(element => isLikelyGeneratedMedia(element, mediaType))
      .map(mediaSource)
      .filter(src => src && !initialSources.has(src));

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
  const initialSources = flowMediaSnapshot(mediaType);
  await sendPrompt("google", prompt, Math.min(task.timeoutMs || 300000, 30000));

  const options = task.payload?.options || {};
  const media = await collectGoogleFlowMedia(
    mediaType,
    task.timeoutMs || 300000,
    expectedQuantity(options),
    initialSources
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
        error: errorWithTrace(err)
      });
    })
    .finally(() => {
      activeFlowTaskId = null;
    });

  activeFlowTaskId = message.task.id;
  sendResponse({ status: "accepted" });
  return false;
});
