import { appOrigin } from './protocol.mjs';
const input = document.getElementById('origin');
const status = document.getElementById('status');
const saved = await chrome.storage.local.get('origins');
if (saved.origins?.length) input.value = saved.origins.at(-1);
document.getElementById('connect').addEventListener('click', async () => {
  try {
    const origin = appOrigin(input.value);
    const { origins = [] } = await chrome.storage.local.get('origins');
    await chrome.storage.local.set({ origins: [...new Set([...origins, origin])] });
    await chrome.tabs.create({ url: `${origin}/flow/images?extensionId=${chrome.runtime.id}` });
    status.textContent = 'Kaoz conectado. Continue na aba aberta.';
  } catch (error) { status.textContent = error.message; }
});
document.getElementById('disconnect').addEventListener('click', async () => {
  await chrome.storage.local.set({ origins: [] });
  status.textContent = 'Endereços personalizados desconectados.';
});
