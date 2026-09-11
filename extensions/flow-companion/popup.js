import { appOrigin } from './protocol.mjs';

const input = document.getElementById('origin');
const feedback = document.getElementById('status');
const companion = document.getElementById('companion');
const companionTitle = document.getElementById('companion-title');
const companionDetail = document.getElementById('companion-detail');
const originsList = document.getElementById('origins');
const versionLabel = document.getElementById('version');
const connectButton = document.getElementById('connect');

function setFeedback(message, tone = '') {
  feedback.textContent = message;
  if (tone) feedback.dataset.tone = tone;
  else delete feedback.dataset.tone;
}

function setCompanion(state, title, detail) {
  companion.dataset.state = state;
  companionTitle.textContent = title;
  companionDetail.textContent = detail;
}

async function savedOrigins() {
  const { origins = [] } = await chrome.storage.local.get('origins');
  return origins;
}

function renderOrigins(origins) {
  originsList.replaceChildren(...origins.map(origin => {
    const item = document.createElement('li');
    item.textContent = origin;
    return item;
  }));
}

function shorten(id) {
  const value = String(id || '');
  return value.length > 8 ? `${value.slice(0, 8)}…` : value;
}

// The popup mirrors the desktop panel: one indicator for the local bridge and
// one for the requests already running in the Flow tab.
async function refreshCompanion() {
  const origins = await savedOrigins();
  renderOrigins(origins);
  try {
    const state = await chrome.runtime.sendMessage({ type: 'companion-state' });
    if (!state?.ok) throw new Error(state?.error || 'Sem resposta do Kaoz.');
    if (state.active) return setCompanion('busy', 'Gerando no Chrome…', `Pedido ${shorten(state.active.id)} · acompanhando o Flow.`);
    if (state.desktop) return setCompanion('online', 'Kaoz.1 Desktop conectado', `Ponte local ativa · extensão v${state.version}`);
    if (origins.length) return setCompanion('online', 'Kaoz autorizado neste navegador', origins[0]);
    return setCompanion('idle', 'Aguardando conexão', 'Conecte o endereço do Kaoz abaixo.');
  } catch {
    return setCompanion('idle', 'Chrome pronto', 'Abra o Kaoz.1 e conecte o endereço abaixo.');
  }
}

versionLabel.textContent = `v${chrome.runtime.getManifest().version}`;
const stored = await savedOrigins();
if (stored.length) input.value = stored.at(-1);
await refreshCompanion();
const timer = setInterval(() => void refreshCompanion(), 2000);
addEventListener('unload', () => clearInterval(timer));

connectButton.addEventListener('click', async () => {
  connectButton.disabled = true;
  try {
    const origin = appOrigin(input.value);
    const origins = await savedOrigins();
    await chrome.storage.local.set({ origins: [...new Set([...origins, origin])] });
    input.value = origin;
    await chrome.tabs.create({ url: `${origin}/flow/images?extensionId=${chrome.runtime.id}` });
    setFeedback('Kaoz conectado. Continue na aba aberta.', 'ok');
  } catch (error) {
    setFeedback(error.message, 'error');
  } finally {
    connectButton.disabled = false;
    await refreshCompanion();
  }
});

document.getElementById('disconnect').addEventListener('click', async () => {
  await chrome.storage.local.set({ origins: [] });
  setFeedback('Endereços personalizados desconectados.', 'ok');
  await refreshCompanion();
});
