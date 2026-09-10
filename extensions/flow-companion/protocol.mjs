export function allowedSender(sender) {
  try {
    const url = new URL(sender.url);
    return ['http://localhost:3000', 'http://127.0.0.1:3000'].includes(url.origin)
      && url.pathname === '/flow-extension-test.html';
  } catch { return false; }
}

export function validPrompt(prompt) {
  return typeof prompt === 'string' && prompt.trim().length > 0 && prompt.length <= 4000;
}

export function allowedImage(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return false;
    return ['flow.google.com', 'labs.google'].includes(url.hostname)
      || url.hostname === 'googleusercontent.com' || url.hostname.endsWith('.googleusercontent.com');
  } catch { return false; }
}
