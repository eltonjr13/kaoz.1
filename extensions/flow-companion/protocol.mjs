export function allowedSender(sender, origins = []) {
  try {
    const url = new URL(sender.url);
    return ['http://localhost:3000', 'http://127.0.0.1:3000', ...origins].includes(url.origin)
      && (url.pathname === '/flow-extension-test.html' || /^\/flow(?:\/|$)/.test(url.pathname));
  } catch { return false; }
}

export function validPrompt(prompt) {
  return typeof prompt === 'string' && prompt.trim().length > 0 && prompt.length <= 16000;
}

export function allowedImage(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return ['flow.google.com', 'labs.google', 'flow-content.google'].includes(url.hostname)
      || url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com');
  } catch { return false; }
}

export function appOrigin(value) {
  const url = new URL(value);
  if (url.username || url.password) throw new Error('Endereço do Kaoz inválido.');
  const local = ['localhost', '127.0.0.1'].includes(url.hostname);
  if (url.protocol !== 'https:' && !(local && url.protocol === 'http:')) throw new Error('Use HTTPS ou localhost para conectar o Kaoz.');
  return url.origin;
}
