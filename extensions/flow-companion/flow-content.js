(() => {
  if (window.__kaozFlowCompanionV2) return;
  window.__kaozFlowCompanionV2 = true;
  let job = null;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const visible = element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
  const text = element => (element.getAttribute('aria-label') || element.textContent || '').trim();
  const all = selector => Array.from(document.querySelectorAll(selector)).filter(visible);
  const button = expression => all('button').find(element => expression.test(text(element)));
  const imageSource = image => image.currentSrc || image.src;
  const imageList = () => Array.from(document.images).filter(image => image.complete && image.naturalWidth >= 256 && image.naturalHeight >= 256);
  const composer = () => all('div[contenteditable="true"]').find(element => !element.closest('nav'));
  async function waitFor(read, message, limit = 30000) {
    const start = Date.now();
    while (Date.now() - start < limit) {
      const value = read();
      if (value) return value;
      await delay(400);
    }
    throw new Error(message);
  }
  async function prepareProject() {
    const create = await waitFor(() => button(/(Novo projeto|New project)$/i), 'Faça login no Flow na aba aberta e tente novamente.');
    create.click();
    await waitFor(composer, 'O editor do Flow não abriu.');
    const agent = button(/^(Agente|Agent)$/i);
    if (agent?.getAttribute('aria-pressed') === 'true') { agent.click(); await delay(300); }
    if (composer().textContent.trim()) throw new Error('O projeto contém um rascunho. Geração interrompida para preservá-lo.');
  }
  async function selectRadio(name) {
    const radio = await waitFor(() => all('[role="radio"]').find(element => text(element).endsWith(name)), 'Opção do Flow indisponível: ' + name, 5000);
    radio.click();
    await delay(150);
  }
  async function configure(options) {
    const trigger = await waitFor(() => button(/Gatilho de configurações|Settings trigger/i), 'Configurações do Flow indisponíveis.');
    trigger.click();
    await selectRadio('Imagem');
    if (options.aspectRatio) await selectRadio(options.aspectRatio);
    await selectRadio('x' + options.quantity);
    const family = button(/Selecionar família de modelos|Select model family/i);
    if (family && !family.textContent.includes(options.model)) {
      family.click();
      const model = await waitFor(() => all('[role="menuitem"], [role="option"], [role="menuitemradio"], button').find(element => text(element) === options.model), 'Modelo indisponível no Flow: ' + options.model, 5000);
      model.click();
      await delay(200);
    }
    trigger.click();
    await delay(200);
    if (!trigger.textContent.includes(options.model)) throw new Error('O Flow não confirmou o modelo solicitado.');
    if (!trigger.textContent.includes('x' + options.quantity)) throw new Error('O Flow não confirmou a quantidade solicitada.');
  }
  const freshImages = before => Array.from(document.images).filter(image => !before.has(imageSource(image)) && visible(image));
  const sha256 = async blob => Array.from(
    new Uint8Array(await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())),
    byte => byte.toString(16).padStart(2, '0')
  ).join('');
  async function attachReference(options) {
    const dataUrl = options.referenceImage;
    if (!dataUrl) return false;
    if (!/^data:image\/(png|jpeg|webp);base64,/.test(dataUrl) || dataUrl.length > 9 * 1024 * 1024) throw new Error('Referência inválida ou grande demais.');
    const blob = await (await fetch(dataUrl)).blob();
    if (options.referenceSha256) {
      const digest = await sha256(blob);
      if (digest !== options.referenceSha256) throw new Error('A referência chegou alterada ao Chrome. Geração interrompida para não usar a imagem errada.');
    }
    const mimeType = options.referenceMimeType || blob.type || 'image/png';
    const safeName = typeof options.referenceName === 'string' ? options.referenceName.replace(/[^A-Za-z0-9._-]/g, '') : '';
    const before = new Set(Array.from(document.images).map(imageSource));
    const transfer = new DataTransfer();
    transfer.items.add(new File([blob], safeName || 'kaoz-reference.' + (mimeType.split('/')[1] || 'png'), { type: mimeType }));
    const input = composer();
    input.focus();
    input.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
    await waitFor(() => freshImages(before)[0], 'O Flow não confirmou o anexo. A geração foi interrompida para não ignorar sua referência.', 20000);
    await delay(600);
    if (freshImages(before).length === 0) throw new Error('O Flow descartou o anexo antes de enviar o pedido. Geração interrompida.');
    job.referenceAttached = true;
    job.attachmentSources = freshImages(before).map(imageSource);
    return true;
  }
  function verifyAttachment() {
    if (!job.referenceAttached) return;
    const current = new Set(Array.from(document.images).map(imageSource));
    if (!(job.attachmentSources || []).some(source => current.has(source))) {
      throw new Error('A referência saiu do pedido antes do envio. Geração interrompida.');
    }
  }
  async function submit(prompt) {
    const input = composer();
    input.focus();
    if (!document.execCommand('insertText', false, prompt)) throw new Error('O editor não aceitou o pedido.');
    const normalizeText = value => value.replace(/\s+/g, ' ').trim();
    if (normalizeText(input.innerText || input.textContent) !== normalizeText(prompt)) throw new Error('O texto do editor diverge do pedido.');
    verifyAttachment();
    const submit = await waitFor(() => {
      const element = button(/^(Iniciar geração|Start generation)$/i);
      return element && !element.disabled ? element : null;
    }, 'O Flow não habilitou a geração.', 5000);
    job.submitted = true;
    submit.click();
  }
  async function originalImage(card) {
    const source = imageSource(card);
    if (source.startsWith('https://flow-content.google/')) return card;
    card.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: window }));
    const original = await waitFor(() => imageList().find(image => imageSource(image).startsWith('https://flow-content.google/')),
      'A imagem foi gerada, mas o Flow não disponibilizou o arquivo original.', 20000);
    return original;
  }
  async function collect(previous, count) {
    const cards = await waitFor(() => {
      const fresh = imageList().filter(image => visible(image) && !previous.has(imageSource(image)) && /^https:\/\//.test(imageSource(image)));
      return fresh.length >= count ? fresh.slice(0, count) : null;
    }, 'O Flow não concluiu as imagens. Confira a aba; o pedido não será reenviado.', 5 * 60_000);
    const sources = cards.map(imageSource);
    const output = [];
    for (const source of sources) {
      const card = await waitFor(() => imageList().find(image => imageSource(image) === source), 'Imagem indisponível na grade.');
      const original = await originalImage(card);
      output.push({ url: imageSource(original), width: original.naturalWidth, height: original.naturalHeight });
      const done = button(/^(Edição concluída|Done editing)$/i);
      if (done) { done.click(); await delay(400); }
    }
    return output;
  }
  async function generate(message) {
    const options = { aspectRatio: '1:1', quantity: 1, model: 'Nano Banana 2', ...message.options };
    if (![1, 2, 3, 4].includes(options.quantity)) throw new Error('Quantidade inválida.');
    await prepareProject();
    job.projectUrl = location.href;
    job.stage = 'Configurando modelo e formato';
    await configure(options);
    job.stage = 'Preparando referência';
    job.referenceAttached = false;
    await attachReference(options);
    const previous = new Set(imageList().map(imageSource));
    job.stage = 'Enviando pedido ao Flow';
    await submit(message.prompt);
    job.stage = 'Gerando imagens no Flow';
    job.images = await collect(previous, options.quantity);
    job.status = 'completed';
    job.stage = 'Imagens prontas para o Kaoz';
  }
  chrome.runtime.onMessage.addListener((message, sender, reply) => {
    if (sender.id !== chrome.runtime.id) return false;
    if (message.type === 'start') {
      if (job) { reply({ ok: job.id === message.id, error: 'Esta aba já tem um pedido.' }); return false; }
      job = { id: message.id, status: 'running', stage: 'Abrindo projeto no Flow', startedAt: Date.now(), submitted: false };
      reply({ ok: true });
      void generate(message).catch(error => { job.status = 'failed'; job.error = error.message; });
      return false;
    }
    if (message.type === 'status') {
      if (!job || job.id !== message.id) reply({ ok: false, error: 'A aba foi recarregada. Confira o Flow antes de gerar novamente.' });
      else reply({ ...job, ok: job.status !== 'failed', elapsedSeconds: Math.round((Date.now() - job.startedAt) / 1000) });
    }
    return false;
  });
})();
