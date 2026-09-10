import { allowedSender, validPrompt } from './protocol.mjs';
import { imageData } from './image-download.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const NATIVE_HOST = 'com.kaoz1.flow_companion';
let lock = Promise.resolve();
let nativePort;
let desktopConfiguration;
let desktopRunner;
function exclusive(action) {
  const result = lock.then(action, action);
  lock = result.catch(() => {});
  return result;
}
async function jobs() {
  const durable = (await chrome.storage.local.get('jobs')).jobs;
  if (durable) return durable;
  const legacy = (await chrome.storage.session.get('jobs')).jobs || {};
  if (Object.keys(legacy).length) await chrome.storage.local.set({ jobs: legacy });
  return legacy;
}
async function save(job) {
  const entries = await jobs();
  entries[job.id] = job;
  const values = Object.values(entries).sort((a, b) => b.startedAt - a.startedAt).slice(0, 30);
  await chrome.storage.local.set({ jobs: Object.fromEntries(values.map(item => [item.id, item])) });
}
async function owned(message, sender) {
  const job = (await jobs())[message.jobId];
  if (!job || job.owner !== new URL(sender.url).origin) throw new Error('Pedido não encontrado para este Kaoz.');
  return job;
}
async function readyTab(tabId) {
  for (let attempt = 0; attempt < 45; attempt++) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete' && tab.url?.startsWith('https://flow.google.com/')) {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['flow-content.js'] });
      return;
    }
    await delay(500);
  }
  throw new Error('O Flow não terminou de abrir. Confira sua conexão e o login.');
}
async function open() {
  const tab = await chrome.tabs.create({ url: 'https://flow.google.com/' });
  return { ok: true, tabId: tab.id };
}
async function prepareRequest(message, sender) {
  if (!validPrompt(message.prompt)) throw new Error('Informe um pedido de até 16000 caracteres.');
  const id = message.requestId || crypto.randomUUID();
  if (!/^[a-zA-Z0-9-]{8,100}$/.test(id)) throw new Error('Identificador inválido.');
  const entries = await jobs();
  const existing = entries[id];
  const owner = new URL(sender.url).origin;
  if (existing) {
    if (existing.owner !== owner) throw new Error('Pedido pertence a outro Kaoz.');
    return { id, owner, existing };
  }
  const active = Object.values(entries).find(job => ['starting', 'running'].includes(job.status));
  if (active) throw new Error('Há um pedido em andamento. Retome ou encerre o acompanhamento no Kaoz.');
  return { id, owner, existing: null };
}
async function start(message, sender) {
  const { id, owner, existing } = await prepareRequest(message, sender);
  if (existing) return { ok: true, jobId: id };
  const tab = await chrome.tabs.create({ url: 'https://flow.google.com/', active: true });
  const job = { id, owner, tabId: tab.id, startedAt: Date.now(), status: 'starting' };
  await save(job);
  try {
    await readyTab(tab.id);
    // The content script owns the ongoing DOM work; service-worker suspension
    // does not resend the command or keep a long message response pending.
    const result = await chrome.tabs.sendMessage(tab.id, { type: 'start', id, prompt: message.prompt.trim(), options: message.options || {} });
    if (!result?.ok) throw new Error(result?.error || 'O Flow não confirmou o pedido.');
    job.status = 'running';
    await save(job);
    return { ok: true, jobId: id };
  } catch (error) {
    job.status = 'failed'; job.error = error.message; await save(job); throw error;
  }
}
async function readStatus(job) {
  const result = await chrome.tabs.sendMessage(job.tabId, { type: 'status', id: job.id });
  if (!result?.ok) throw new Error(result?.error || 'A aba perdeu a sessão. Confira o Flow; o pedido não será reenviado.');
  if (Date.now() - job.startedAt > 7 * 60_000 && result.status !== 'completed') throw new Error('A geração excedeu sete minutos. Confira o Flow antes de tentar outro pedido.');
  return result;
}
async function status(message, sender) {
  const job = await owned(message, sender);
  if (job.status === 'failed') return { ok: false, error: job.error };
  if (job.status === 'completed') return { ok: true, status: 'completed', images: job.images, projectUrl: job.projectUrl };
  try {
    const result = await readStatus(job);
    if (result.status === 'completed') {
      Object.assign(job, { status: 'completed', images: result.images, projectUrl: result.projectUrl });
      await save(job);
    }
    return result;
  } catch (error) {
    job.status = 'failed'; job.error = error.message; await save(job); throw error;
  }
}
async function getImage(message, sender) {
  const job = await owned(message, sender);
  if (job.status !== 'completed' || !Number.isInteger(message.index) || !job.images[message.index]) throw new Error('Imagem ainda indisponível.');
  return { ok: true, ...await imageData(job.images[message.index].url) };
}
async function finish(message, sender) {
  const job = await owned(message, sender);
  // Ending tracking never cancels a generation at Google or deletes its media.
  job.status = 'acknowledged';
  await save(job);
  return { ok: true };
}
const routes = {
  ping: async () => ({ ok: true, version: chrome.runtime.getManifest().version }),
  open, start, status, image: getImage, acknowledge: finish,
};

function validDesktopConfiguration(message) {
  try {
    const url = new URL(message.baseUrl);
    return message.type === 'configure' && url.protocol === 'http:' && url.hostname === '127.0.0.1' && Boolean(url.port)
      && /^[a-f0-9]{64}$/.test(message.token);
  } catch { return false; }
}

function desktopHeaders(configuration) {
  return {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${configuration.token}`,
    'X-Kaoz-Flow-Extension-Version': chrome.runtime.getManifest().version,
  };
}

async function reportDesktop(configuration, command, payload) {
  const response = await fetch(`${configuration.baseUrl}/api/flow/desktop-companion`, {
    method: 'POST',
    headers: desktopHeaders(configuration),
    body: JSON.stringify({ id: command.id, ...payload }),
  });
  if (!response.ok) throw new Error((await response.json()).error || 'O desktop não aceitou o resultado do Flow.');
}

async function runDesktopCommand(configuration, command) {
  const sender = { url: `${configuration.baseUrl}/flow/images`, tab: { id: -1 } };
  try {
    const started = await exclusive(() => start({ ...command, requestId: command.id }, sender));
    for (let attempt = 0; attempt < 150; attempt++) {
      const result = await exclusive(() => status({ type: 'status', jobId: started.jobId }, sender));
      if (result.status === 'completed') {
        const images = [];
        for (let index = 0; index < (result.images?.length || 0); index++) {
          const image = await exclusive(() => getImage({ type: 'image', jobId: started.jobId, index }, sender));
          if (!image.dataUrl) throw new Error('O Flow não retornou a imagem original.');
          images.push(image.dataUrl);
        }
        await reportDesktop(configuration, command, { images });
        await exclusive(() => finish({ type: 'acknowledge', jobId: started.jobId }, sender));
        return;
      }
      await delay(2500);
    }
    throw new Error('A geração excedeu o tempo de espera. Confira a aba do Flow.');
  } catch (error) {
    await reportDesktop(configuration, command, { error: error instanceof Error ? error.message : String(error) }).catch(() => {});
  }
}

function startDesktopRunner() {
  if (desktopRunner || !desktopConfiguration) return;
  desktopRunner = (async () => {
    while (desktopConfiguration) {
      const configuration = desktopConfiguration;
      try {
        const response = await fetch(`${configuration.baseUrl}/api/flow/desktop-companion`, {
          headers: desktopHeaders(configuration),
          cache: 'no-store',
        });
        if (!response.ok) throw new Error('O aplicativo desktop recusou a conexão.');
        const { command } = await response.json();
        if (command) await runDesktopCommand(configuration, command);
      } catch { /* Reconnect and runtime changes are handled by the native host. */ }
      await delay(1500);
    }
  })().finally(() => {
    desktopRunner = undefined;
    if (desktopConfiguration) startDesktopRunner();
  });
}

function connectNativeBridge() {
  if (typeof chrome.runtime.connectNative !== 'function' || nativePort) return;
  try {
    const port = chrome.runtime.connectNative(NATIVE_HOST);
    nativePort = port;
    port.onMessage.addListener(message => {
      if (validDesktopConfiguration(message)) {
        desktopConfiguration = { baseUrl: message.baseUrl, token: message.token };
        startDesktopRunner();
      } else if (message?.type === 'unavailable') {
        desktopConfiguration = undefined;
      }
    });
    port.onDisconnect.addListener(() => {
      nativePort = undefined;
      desktopConfiguration = undefined;
      setTimeout(connectNativeBridge, 1500);
    });
    port.postMessage({ type: 'ping' });
  } catch {
    nativePort = undefined;
    setTimeout(connectNativeBridge, 3000);
  }
}

chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  void (async () => {
    const { origins = [] } = await chrome.storage.local.get('origins');
    if (!allowedSender(sender, origins) || !sender.tab) throw new Error('Conecte este endereço pelo ícone da extensão.');
    const handler = Object.hasOwn(routes, message?.type) ? routes[message.type] : null;
    if (!handler) throw new Error('Comando desconhecido.');
    return exclusive(() => handler(message, sender));
  })().then(reply).catch(error => reply({ ok: false, error: error.message }));
  return true;
});
chrome.runtime.onStartup?.addListener(connectNativeBridge);
chrome.runtime.onInstalled?.addListener(connectNativeBridge);
connectNativeBridge();
