import { allowedSender, validPrompt, allowedImage } from './protocol.mjs';

const FLOW_URLS = ['https://flow.google.com/*', 'https://flow.google/*', 'https://labs.google/*'];
let starting = false;

async function imageData(url) {
  if (!allowedImage(url)) throw new Error('Origem da imagem não permitida.');
  const response = await fetch(url, { credentials: 'include', signal: AbortSignal.timeout(30000) });
  if (!response.ok || !allowedImage(response.url)) throw new Error('Não foi possível baixar a imagem do Flow.');
  const mime = response.headers.get('content-type')?.split(';')[0];
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(mime)) throw new Error('O resultado não é uma imagem suportada.');
  const chunks = await readImageChunks(response.body);
  let binary = '';
  for (const chunk of chunks) {
    for (let offset = 0; offset < chunk.length; offset += 8192) {
      binary += String.fromCharCode(...chunk.subarray(offset, offset + 8192));
    }
  }
  return { dataUrl: `data:${mime};base64,${btoa(binary)}`, bytes: binary.length, mime };
}

async function readImageChunks(body) {
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 12 * 1024 * 1024) {
      await reader.cancel();
      throw new Error('Imagem excede o limite de 12 MB deste teste.');
    }
    chunks.push(value);
  }
  return chunks;
}

function ensureStarted(result) {
  if (!result?.ok) throw new Error(result?.error || 'A extensão não recebeu confirmação do Flow.');
}

async function start(message, sender) {
  if (!validPrompt(message.prompt)) throw new Error('Informe um pedido de até 4000 caracteres.');
  if (starting) throw new Error('Já existe uma solicitação sendo iniciada.');
  starting = true;
  try {
    const { activeJob } = await chrome.storage.session.get('activeJob');
    if (activeJob && Date.now() - activeJob.startedAt < 210000) throw new Error('Já existe uma geração em andamento. Aguarde o resultado.');
    const tabs = await chrome.tabs.query({ url: FLOW_URLS });
    const projects = tabs.filter(tab => /\/project\//.test(tab.url));
    if (projects.length !== 1) throw new Error('Deixe exatamente uma aba de projeto do Flow aberta para este teste.');
    const tab = projects[0];
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['flow-content.js'] });
    const job = { id: crypto.randomUUID(), tabId: tab.id, owner: sender.tab.id, startedAt: Date.now() };
    await chrome.storage.session.set({ activeJob: job });
    try {
      const result = await chrome.tabs.sendMessage(tab.id, { type: 'start', id: job.id, prompt: message.prompt.trim() });
      ensureStarted(result);
      return { ok: true, jobId: job.id };
    } catch (error) {
      await chrome.storage.session.remove('activeJob');
      throw error;
    }
  } finally { starting = false; }
}

async function status(message, sender) {
  const { activeJob } = await chrome.storage.session.get('activeJob');
  if (!activeJob || activeJob.id !== message.jobId || activeJob.owner !== sender.tab.id) throw new Error('Geração não encontrada nesta aba.');
  const result = await chrome.tabs.sendMessage(activeJob.tabId, { type: 'status', id: activeJob.id });
  if (!result?.ok) throw new Error(result?.error || 'A aba do Flow foi recarregada. Não reenvie sem verificar o resultado.');
  if (result.status !== 'completed') return result;
  const image = await imageData(result.imageUrl);
  await chrome.storage.session.remove('activeJob');
  return { ...result, ...image };
}

chrome.runtime.onMessageExternal.addListener((message, sender, reply) => {
  if (!allowedSender(sender) || !sender.tab) {
    reply({ ok: false, error: 'Esta página não está autorizada.' });
    return false;
  }
  const routes = { ping: async () => ({ ok: true, version: chrome.runtime.getManifest().version }), start, status };
  const handler = Object.hasOwn(routes, message?.type) ? routes[message.type] : null;
  if (!handler) { reply({ ok: false, error: 'Comando desconhecido.' }); return false; }
  handler(message, sender).then(reply).catch(error => reply({ ok: false, error: error.message }));
  return true;
});
