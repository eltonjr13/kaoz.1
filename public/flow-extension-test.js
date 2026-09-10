(() => {
  const element = id => document.getElementById(id);
  const extension = element('extension');
  extension.value = new URLSearchParams(location.search).get('extensionId') || '';
  let connected = false;
  let running = false;

  function send(message) {
    return new Promise((resolve, reject) => {
      if (!/^[a-p]{32}$/.test(extension.value)) return reject(new Error('Informe o ID da extensão instalada.'));
      if (!window.chrome?.runtime?.sendMessage) return reject(new Error('Instale a extensão e reabra esta página pelo ícone dela.'));
      const timeout = setTimeout(() => reject(new Error('A extensão não respondeu. Confira o Flow antes de tentar novamente.')), 45000);
      window.chrome.runtime.sendMessage(extension.value, message, response => {
        clearTimeout(timeout);
        const error = window.chrome.runtime.lastError;
        if (error) reject(new Error(error.message));
        else if (!response?.ok) reject(new Error(response?.error || 'Resposta inválida da extensão.'));
        else resolve(response);
      });
    });
  }

  async function connect() {
    try {
      const result = await send({ type: 'ping' });
      connected = true;
      element('connection').textContent = `Extensão conectada · versão ${result.version}`;
    } catch (error) {
      connected = false;
      element('connection').textContent = error.message;
    }
    element('generate').disabled = !connected || running;
  }

  function show(result) {
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(result.dataUrl)) throw new Error('A extensão não devolveu um arquivo de imagem.');
    const url = new URL(result.projectUrl);
    if (url.protocol !== 'https:' || !['flow.google.com', 'labs.google', 'flow.google'].includes(url.hostname)) throw new Error('Endereço de projeto inválido.');
    element('image').src = result.dataUrl;
    element('download').href = result.dataUrl;
    element('download').download = `kaoz-flow-teste.${result.mime === 'image/jpeg' ? 'jpg' : result.mime.split('/')[1]}`;
    element('project').href = url.href;
    element('details').textContent = `${result.width} × ${result.height} · ${Math.round(result.bytes / 1024)} KB · recebida pela extensão`;
    element('result').hidden = false;
    element('progress').textContent = 'Concluído: imagem gerada no Flow e recebida no app.';
  }

  async function generate() {
    if (running || !connected) return;
    running = true;
    element('generate').disabled = true;
    element('connect').disabled = true;
    extension.disabled = true;
    element('result').hidden = true;
    element('progress').textContent = 'Enviando pedido à extensão…';
    try {
      const { jobId } = await send({ type: 'start', prompt: element('prompt').value });
      for (let attempt = 0; attempt < 65; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 3000));
        const result = await send({ type: 'status', jobId });
        if (result.status === 'completed') { show(result); return; }
        element('progress').textContent = `Gerando no Flow… ${result.elapsedSeconds}s`;
      }
      throw new Error('Espera encerrada. Verifique o Flow antes de gerar novamente.');
    } catch (error) { element('progress').textContent = error.message; }
    finally {
      running = false;
      element('generate').disabled = !connected;
      element('connect').disabled = false;
      extension.disabled = false;
    }
  }

  element('connect').addEventListener('click', connect);
  element('generate').addEventListener('click', generate);
  extension.addEventListener('input', () => { connected = false; element('generate').disabled = true; });
  if (extension.value) void connect();
})();
