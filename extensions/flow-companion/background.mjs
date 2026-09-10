import { allowedSender, validPrompt } from './protocol.mjs';
import { imageData } from './image-download.mjs';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
let lock = Promise.resolve();
function exclusive(action) {
  const result = lock.then(action, action);
  lock = result.catch(() => {});
  return result;
}
async function jobs() { return (await chrome.storage.session.get('jobs')).jobs || {}; }
async function save(job) {
  const entries = await jobs();
  entries[job.id] = job;
  const values = Object.values(entries).sort((a, b) => b.startedAt - a.startedAt).slice(0, 30);
  await chrome.storage.session.set({ jobs: Object.fromEntries(values.map(item => [item.id, item])) });
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
