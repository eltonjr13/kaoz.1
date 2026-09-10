(() => {
  // Reinjection on the same tab must not add listeners or submit a second job.
  if (window.__kaozFlowCompanion) return;
  window.__kaozFlowCompanion = true;
  let job = null;
  const visible = element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  const buttons = () => Array.from(document.querySelectorAll('button')).filter(visible);
  const label = element => element.getAttribute('aria-label') || element.textContent || '';
  const images = () => Array.from(document.images).filter(image => visible(image)
    && image.naturalWidth >= 256 && image.naturalHeight >= 256 && !image.closest('nav'));

  function controls() {
    const composer = Array.from(document.querySelectorAll('div[contenteditable="true"]')).find(visible);
    const submit = buttons().find(button => /^(Iniciar geração|Start generation)$/i.test(label(button)));
    const model = buttons().find(button => /Nano Banana|Imagen/.test(button.textContent));
    const agent = buttons().find(button => /^(Agente|Agent)$/.test(label(button)));
    if (!composer || !submit) throw new Error('Abra um projeto e faça login normalmente no Flow antes do teste.');
    if (agent?.getAttribute('aria-pressed') === 'true') throw new Error('Desative o modo Agente no Flow antes do teste.');
    if (!model || !/x1\b/.test(model.textContent)) throw new Error('Selecione um modelo de imagem e quantidade x1 no Flow.');
    if (composer.textContent.trim()) throw new Error('A caixa de comando já contém texto. Use um projeto vazio para preservar seu trabalho.');
    return { composer, submit };
  }

  function start(message) {
    if (job?.status === 'running') throw new Error('Já existe uma geração nesta aba.');
    const { composer, submit } = controls();
    const previous = new Set(images().map(image => image.currentSrc || image.src));
    composer.focus();
    // ProseMirror handles the native editing input event and updates its state.
    if (!document.execCommand('insertText', false, message.prompt)) throw new Error('O editor não aceitou o pedido.');
    if (composer.textContent.trim() !== message.prompt) throw new Error('O texto do editor diverge do pedido. Geração não enviada.');
    if (submit.disabled) throw new Error('O botão de geração continua desativado.');
    job = { id: message.id, status: 'running', startedAt: Date.now(), previous };
    submit.click();
    return { ok: true };
  }

  function status(id) {
    if (!job || job.id !== id) throw new Error('Sessão da extensão perdida. Verifique a aba do Flow antes de gerar novamente.');
    const image = images().find(item => !job.previous.has(item.currentSrc || item.src));
    if (image) {
      job.status = 'completed';
      return { ok: true, status: job.status, imageUrl: image.currentSrc || image.src,
        width: image.naturalWidth, height: image.naturalHeight, projectUrl: location.href };
    }
    if (Date.now() - job.startedAt > 180000) throw new Error('Tempo de espera esgotado. Confira o Flow; o pedido não será reenviado automaticamente.');
    return { ok: true, status: 'running', elapsedSeconds: Math.round((Date.now() - job.startedAt) / 1000) };
  }

  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return false;
    try {
      if (message.type === 'start') reply(start(message));
      else if (message.type === 'status') reply(status(message.id));
    } catch (error) { reply({ ok: false, error: error.message }); }
    return false;
  });
})();
