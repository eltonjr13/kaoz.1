import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { Locator, Page } from 'playwright';
import { ImageGenerationResult, FlowConfig, ImageGenerationOptions } from './FlowTypes';
import { logger, findSmartElement, ElementQuery, pollCondition, getSavedProjectUrl, saveProjectUrl, ensureDirExists, generateFilename, normalizeFlowProjectUrl } from './FlowUtils';
import { FlowDownloader } from './FlowDownloader';
import { convertImageToPdf } from './FlowPdfHelper';
import { imageOperationRequiresReference } from './ImageGenerationContract';

const PROMPT_TEXTBOX_SELECTOR = 'div[role="textbox"], div[contenteditable="true"], [contenteditable="true"], textarea';

export class FlowImageGenerator {
  private lastUploadedReferenceImage: string | null = null;
  private lastProjectUrl: string | null = null;

  constructor(private downloader: FlowDownloader, private config: FlowConfig) {}

  private getImageExtension(mimeType: string): string {
    if (/jpe?g/i.test(mimeType)) return '.jpg';
    if (/webp/i.test(mimeType)) return '.webp';
    return '.png';
  }

  private generateImageId(): string {
    const alphabet = 'abcdefghijklmnopqrstuvwxyz';
    const length = 9;
    return Array.from({ length }, () => alphabet[crypto.randomInt(alphabet.length)]).join('');
  }

  private async saveImageCardFallback(
    card: Locator,
    options?: ImageGenerationOptions,
    filenameBase?: string
  ): Promise<{ success: boolean; path: string; filename: string; createdAt: string } | null> {
    try {
      const imageData = await card.evaluate(async (el) => {
        const image = el as HTMLImageElement;
        const source = image.currentSrc || image.src || image.getAttribute('src') || '';
        if (!source) {
          throw new Error('Card sem src de imagem.');
        }

        const response = await fetch(source);
        if (!response.ok) {
          throw new Error(`Falha ao buscar imagem do card: ${response.status}`);
        }

        const blob = await response.blob();
        const arrayBuffer = await blob.arrayBuffer();
        return {
          bytes: Array.from(new Uint8Array(arrayBuffer)),
          mimeType: blob.type || response.headers.get('content-type') || 'image/png'
        };
      });

      const ext = this.getImageExtension(imageData.mimeType);
      const customFolder = options?.folderName && options?.originalFilename
        ? `${options.folderName}/${options.originalFilename}`
        : undefined;
      const filename = filenameBase
        ? `${filenameBase}${ext}`
        : generateFilename('image', ext);
      const targetDir = customFolder
        ? path.resolve(this.config.downloadPath, 'patterns', customFolder)
        : path.resolve(this.config.downloadPath, 'images');

      ensureDirExists(targetDir);
      const targetPath = path.join(targetDir, filename);
      await fs.promises.writeFile(targetPath, Buffer.from(imageData.bytes));
      logger.info('Imagem salva por fallback direto do card.', { filename, targetPath });

      return {
        success: true,
        path: targetPath,
        filename,
        createdAt: new Date().toISOString()
      };
    } catch (fallbackErr) {
      logger.warn('Fallback de download direto do card falhou.', fallbackErr);
      return null;
    }
  }

  /**
   * Checks if a reference image is already attached to the prompt input.
   */
  private async isReferenceImageAttached(page: Page): Promise<boolean> {
    try {
      // eslint-disable-next-line complexity
      const isAttached = await page.evaluate((promptSelector) => {
        const visibleTextboxes = Array.from(document.querySelectorAll<HTMLElement>(promptSelector))
          .filter((element) => {
            const rect = element.getBoundingClientRect();
            const style = window.getComputedStyle(element);
            return rect.width > 10 && rect.height > 10 && style.display !== "none" && style.visibility !== "hidden";
          })
          .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
        const textbox = visibleTextboxes[0];
        if (!textbox) return false;

        const textboxRect = textbox.getBoundingClientRect();
        const isPromptThumbnail = (image: HTMLImageElement) => {
          const rect = image.getBoundingClientRect();
          const style = window.getComputedStyle(image);
          const isVisible = rect.width > 20 && rect.height > 20 && style.display !== "none" && style.visibility !== "hidden";
          const isNearPrompt = rect.bottom >= textboxRect.top - 360 && rect.top <= textboxRect.bottom + 160;
          return isVisible && isNearPrompt && rect.width < 280 && rect.height < 280;
        };

        if (Array.from(document.querySelectorAll<HTMLImageElement>('img')).some(isPromptThumbnail)) return true;

        let parent = textbox.parentElement;
        for (let i = 0; i < 8 && parent && parent !== document.body; i++) {
          const containerImgs = parent.querySelectorAll('img');
          for (const img of Array.from(containerImgs)) {
            const src = img.src || '';
            const isRef = /blob|googleusercontent|usercontent\.google|data:image/i.test(src);
            const rect = img.getBoundingClientRect();
            if (isRef || (rect.width > 20 && rect.height > 20)) {
              return true;
            }
          }
          parent = parent.parentElement;
        }
        return false;
      }, PROMPT_TEXTBOX_SELECTOR);
      return isAttached;
    } catch (err) {
      logger.warn('Falha ao verificar se imagem de referência já está anexada:', err);
      return false;
    }
  }

  private getReferenceNameFragments(referenceImage: string, includeGenericPrefixes = true): string[] {
    const basename = path.basename(referenceImage);
    const ext = path.extname(basename);
    const stem = ext ? basename.slice(0, -ext.length) : basename;
    const idMatch = stem.match(/^((?:agent_|chat_)?ref_image_|avatar_ref_)([A-Za-z0-9-]+)/);
    const idFragment = idMatch ? `${idMatch[1]}${idMatch[2].slice(0, 8)}` : '';
    const truncatedStem = stem.length > 24 ? stem.slice(0, 24) : '';

    const fragments = [
      basename,
      stem,
      idFragment,
      truncatedStem,
      ...(includeGenericPrefixes ? [
        'agent_ref_image_',
        'chat_ref_image_',
        'ref_image_',
        'avatar_ref_'
      ] : [])
    ];

    return Array.from(new Set(fragments.filter(Boolean)));
  }

  private async findVisibleReferenceAsset(
    dialog: Locator,
    referenceImage: string,
    includeGenericPrefixes = true
  ): Promise<{ item: Locator; fragment: string } | null> {
    for (const fragment of this.getReferenceNameFragments(referenceImage, includeGenericPrefixes)) {
      const namedItem = dialog.getByText(fragment, { exact: false }).filter({ visible: true }).first();
      if (await namedItem.count() > 0 && await namedItem.isVisible()) {
        return { item: namedItem, fragment };
      }
    }

    return null;
  }

  private async waitForUploadedReferenceAsset(
    page: Page,
    dialog: Locator,
    referenceImage: string
  ): Promise<{ item: Locator; fragment: string } | null> {
    const deadline = Date.now() + 45000;
    while (Date.now() < deadline) {
      const match = await this.findVisibleReferenceAsset(dialog, referenceImage, false);
      if (match) return match;
      await page.waitForTimeout(1000);
    }

    return null;
  }

  private async selectReferenceAsset(
    page: Page,
    dialog: Locator,
    referenceImage: string,
    requireUploadedAsset: boolean
  ): Promise<void> {
    const namedAsset = requireUploadedAsset
      ? await this.waitForUploadedReferenceAsset(page, dialog, referenceImage)
      : await this.findVisibleReferenceAsset(dialog, referenceImage);
    if (namedAsset) {
      logger.info(`Recurso de referencia localizado no Flow pelo nome: ${namedAsset.fragment}`);
      await namedAsset.item.click();
      return;
    }

    if (requireUploadedAsset) {
      throw new Error('O upload da imagem de referencia nao apareceu na lista do Flow. Geracao bloqueada para evitar anexar uma imagem anterior.');
    }

    logger.warn('Nao encontrei o recurso de referencia pelo nome no Flow. Selecionando o primeiro thumbnail visivel como fallback.');
    const thumbnail = dialog.locator('img').filter({ visible: true }).first();
    await thumbnail.waitFor({ state: 'visible', timeout: 15000 });
    await thumbnail.click();
  }

  private shouldReuseExistingAttachment(
    alreadyAttached: boolean,
    skipUpload: boolean,
    forceReferenceSelection: boolean
  ): boolean {
    return alreadyAttached && skipUpload && !forceReferenceSelection;
  }

  private async clearPromptDraft(page: Page): Promise<void> {
    const focused = await page.evaluate((promptSelector) => {
      const visibleTextboxes = Array.from(document.querySelectorAll<HTMLElement>(promptSelector))
        .filter((element) => {
          const rect = element.getBoundingClientRect();
          const style = window.getComputedStyle(element);
          return rect.width > 10 && rect.height > 10 && style.display !== "none" && style.visibility !== "hidden";
        })
        .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
      const promptInput = visibleTextboxes[0];
      if (!promptInput) return false;
      promptInput.focus();
      promptInput.click();
      return true;
    }, PROMPT_TEXTBOX_SELECTOR).catch(() => false);
    if (!focused) return;

    await page.keyboard.press('Control+A').catch(() => undefined);
    await page.keyboard.press('Backspace').catch(() => undefined);
    await page.waitForTimeout(300);
  }

  // eslint-disable-next-line complexity
  private async removeVisiblePromptReferenceAttachments(page: Page): Promise<{ removed: number; remaining: number }> {
    return page.evaluate((promptSelector) => {
      const isVisibleElement = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 1 && rect.height > 1 && style.display !== "none" && style.visibility !== "hidden";
      };
      const textboxes = Array.from(document.querySelectorAll<HTMLElement>(promptSelector))
        .filter(isVisibleElement)
        .sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom);
      const textbox = textboxes[0];
      if (!textbox) return { removed: 0, remaining: 0 };
      const textboxRect = textbox.getBoundingClientRect();

      const isReferenceImage = (image: HTMLImageElement) => {
        const rect = image.getBoundingClientRect();
        const isThumbnailSize = rect.width > 20 && rect.height > 20 && rect.width < 280 && rect.height < 280;
        const isPromptArea = rect.bottom >= textboxRect.top - 360 && rect.top <= textboxRect.bottom + 160;
        return isThumbnailSize && isPromptArea && isVisibleElement(image);
      };
      const looksLikeRemoveControl = (element: HTMLElement) => {
        const text = element.textContent?.trim() || "";
        const label = element.getAttribute("aria-label") || element.getAttribute("title") || "";
        const className = element.className?.toString() || "";
        return /close|remove|delete|cancel|clear|fechar|remover|excluir/i.test(`${text} ${label} ${className}`);
      };
      const clickControlNearImage = (image: HTMLImageElement) => {
        const rect = image.getBoundingClientRect();
        const points = [
          [rect.right - 6, rect.top + 6],
          [rect.right + 6, rect.top - 6],
          [rect.right - 12, rect.top + 12],
          [rect.left + 8, rect.top + 8]
        ];

        for (const [x, y] of points) {
          const target = document.elementFromPoint(x, y);
          const control = target?.closest<HTMLElement>("button, [role='button']");
          if (control && isVisibleElement(control)) {
            control.click();
            return true;
          }
        }
        return false;
      };
      const findControlInCard = (image: HTMLImageElement) => {
        let parent: HTMLElement | null = image.parentElement;
        for (let depth = 0; depth < 6 && parent && parent !== document.body; depth++) {
          const control = Array.from(parent.querySelectorAll<HTMLElement>("button, [role='button']"))
            .find((candidate) => isVisibleElement(candidate) && looksLikeRemoveControl(candidate));
          if (control) return control;
          parent = parent.parentElement;
        }
        return null;
      };

      let removed = 0;
      for (const image of Array.from(document.querySelectorAll<HTMLImageElement>("img")).filter(isReferenceImage)) {
        image.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        const card = image.closest<HTMLElement>("div, [role='listitem'], [data-testid]");
        card?.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
        const control = findControlInCard(image);

        if (control) {
          control.click();
          removed++;
        } else if (clickControlNearImage(image)) {
          removed++;
        }
      }

      const remaining = Array.from(document.querySelectorAll<HTMLImageElement>("img")).filter(isReferenceImage).length;
      return { removed, remaining };
    }, PROMPT_TEXTBOX_SELECTOR).catch(() => ({ removed: 0, remaining: 0 }));
  }

  private async clearPromptReferenceAttachments(page: Page): Promise<void> {
    await this.clearPromptDraft(page);

    let removedTotal = 0;
    let remaining = 0;
    for (let attempt = 0; attempt < 3; attempt++) {
      const result = await this.removeVisiblePromptReferenceAttachments(page);
      removedTotal += result.removed;
      remaining = result.remaining;
      if (result.removed === 0) break;
      await page.waitForTimeout(500);
    }

    if (removedTotal > 0) {
      logger.info(`Removi ${removedTotal} anexo(s) antigo(s) do prompt antes de anexar a nova referencia.`);
      await page.waitForTimeout(800);
    }
    if (remaining > 0) {
      throw new Error('Ainda existe anexo antigo no prompt do Flow depois da limpeza. Geracao bloqueada para evitar misturar imagens.');
    }
  }

  private getCleanFlowEntryUrl(): string {
    const targetUrl = this.config.imageUrl || this.config.flowUrl || 'https://flow.google';
    const projectMarkerIndex = targetUrl.indexOf('/project/');
    return projectMarkerIndex >= 0 ? `${targetUrl.slice(0, projectMarkerIndex)}/` : targetUrl;
  }

  private async openCleanWorkspaceForReferenceUpload(page: Page): Promise<void> {
    const targetUrl = this.getCleanFlowEntryUrl();
    logger.warn('Anexo antigo persistiu no prompt. Abrindo um workspace limpo do Flow antes do upload da nova referencia.');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');

    const entryButton = page.getByText(/Create with Google Flow|Criar com o Google Flow|Create with Flow|Criar com o Flow/i).first();
    if (await entryButton.isVisible().catch(() => false)) {
      await entryButton.click();
      await page.waitForTimeout(4000);
    }

    const newProjectBtn = page.locator('button:has-text("Novo projeto"), button:has-text("New project")').first();
    const canCreateProject = await newProjectBtn.waitFor({ state: 'visible', timeout: 8000 })
      .then(() => true)
      .catch(() => false);
    if (canCreateProject) {
      await newProjectBtn.click();
      await page.waitForTimeout(4000);
    }

    const activeUrl = page.url();
    const workspaceUrl = normalizeFlowProjectUrl(activeUrl);
    if (workspaceUrl) {
      if (workspaceUrl !== activeUrl) {
        await page.goto(workspaceUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      }
      saveProjectUrl(workspaceUrl);
      this.lastProjectUrl = workspaceUrl;
    }

    const workspaceTextbox = page.locator('[role="textbox"], div[contenteditable="true"]').first();
    await workspaceTextbox.waitFor({ state: 'visible', timeout: 30000 });
    const promptPlusBtn = page.locator('button').filter({ hasText: 'add_2' }).first();
    await promptPlusBtn.waitFor({ state: 'visible', timeout: 15000 });

    this.lastUploadedReferenceImage = null;
  }

  private async confirmReferenceInclude(dialog: Locator): Promise<void> {
    const includeBtn = dialog.locator('button:has-text("Incluir no comando"), button:has-text("Include in prompt"), button:has-text("Incluir")').first();
    if (await includeBtn.isVisible()) {
      await includeBtn.click();
      logger.info('Botao de inclusao clicado.');
      return;
    }

    logger.info('Botao de inclusao nao visivel (imagem anexada automaticamente).');
  }

  private async prepareReferenceFile(
    page: Page,
    fileInput: Locator,
    referenceImage: string
  ): Promise<boolean> {
    await fileInput.waitFor({ state: 'attached', timeout: 15000 });
    logger.info('Input de arquivo de referencia localizado. Fazendo upload...');
    await fileInput.setInputFiles(referenceImage);
    logger.info('Arquivo enviado. Aguardando o Flow iniciar o processamento do upload...');
    await page.waitForTimeout(2000);
    return true;
  }

  private async preparePromptForFreshReference(
    page: Page
  ): Promise<void> {
    try {
      await this.clearPromptReferenceAttachments(page);
    } catch (clearErr) {
      logger.warn('Falha ao limpar anexos antigos no workspace atual.', clearErr);
      await this.openCleanWorkspaceForReferenceUpload(page);
    }
  }

  private async prepareWorkspaceForOperation(page: Page, options?: ImageGenerationOptions): Promise<void> {
    const operation = options?.operation || (options?.referenceImage ? 'reference' : 'simple');
    if (imageOperationRequiresReference(operation) && !options?.referenceImage) {
      throw new Error(`O modo de imagem '${operation}' exige uma imagem de referencia.`);
    }

    if (operation !== 'simple') return;
    const hasStaleReference = await this.isReferenceImageAttached(page);
    if (!hasStaleReference) {
      this.lastUploadedReferenceImage = null;
      return;
    }

    logger.info('Geracao simples solicitada. Removendo referencias visuais deixadas por execucoes anteriores.');
    try {
      await this.clearPromptReferenceAttachments(page);
    } catch (error) {
      logger.warn('Nao foi possivel limpar a referencia antiga no workspace atual. Abrindo um workspace limpo.', error);
      await this.openCleanWorkspaceForReferenceUpload(page);
    }
    this.lastUploadedReferenceImage = null;
  }

  /**
   * Uploads a reference image to the workspace.
   */
  private async uploadReferenceImage(
    page: Page,
    referenceImage: string,
    skipUpload = false,
    useExistingFlowReference = false,
    forceReferenceSelection = false
  ): Promise<void> {
    logger.info(`Upload de imagem de referência solicitado: ${referenceImage} (skipUpload: ${skipUpload})`);

    // Only reuse an existing attachment when this run explicitly targets the same Flow reference.
    const alreadyAttached = await this.isReferenceImageAttached(page);
    if (this.shouldReuseExistingAttachment(alreadyAttached, skipUpload, forceReferenceSelection)) {
      logger.info('Imagem de referência já detectada como anexada no prompt. Pulando upload e anexo.');
      return;
    }

    if (alreadyAttached) {
      logger.info('Ja existe uma imagem no prompt, mas a referencia solicitada precisa ser anexada novamente.');
    } else if (useExistingFlowReference) {
      logger.info('Referencia existente solicitada, mas nenhum anexo confiavel foi detectado. Reenviando o arquivo local para evitar midia antiga.');
    }
    await this.preparePromptForFreshReference(page);

    const promptPlusBtn = page.locator('button').filter({ hasText: 'add_2' }).first();
    const fileInput = page.locator('input[type="file"]').first();
    try {
      await promptPlusBtn.waitFor({ state: 'visible', timeout: 15000 });

      const uploadedFileThisRun = await this.prepareReferenceFile(page, fileInput, referenceImage);

      logger.info('Abrindo menu de mídia do prompt...');
      await promptPlusBtn.click();
      await page.waitForTimeout(2000);

      logger.info('Localizando caixa de diálogo de recursos...');
      const dialog = page.locator('[role="dialog"], [role="menu"], [data-state="open"]').filter({ hasText: 'Incluir no comando' }).first();
      await dialog.waitFor({ state: 'visible', timeout: 30000 });

      // Avoid search because Flow can truncate filenames in the media list.
      logger.info('Selecionando recurso de referencia na lista...');
      await this.selectReferenceAsset(page, dialog, referenceImage, uploadedFileThisRun);
      await page.waitForTimeout(1000);

      logger.info('Confirmando inclusão da imagem no comando...');
      await this.confirmReferenceInclude(dialog);
      
      logger.info('Imagem de referência anexada com sucesso ao prompt.');
      await page.waitForTimeout(1500);
    } catch (uploadErr) {
      logger.error('Falha ao enviar e anexar imagem de referência:', uploadErr);
      throw new Error(`Erro ao enviar imagem de referência: ${uploadErr instanceof Error ? uploadErr.message : String(uploadErr)}`);
    }
  }

  /**
   * Generates an image using Google Flow.
   */
  // eslint-disable-next-line complexity
  async generate(page: Page, prompt: string, timeoutMs: number, options?: ImageGenerationOptions): Promise<ImageGenerationResult> {
    const savedUrl = getSavedProjectUrl();
    const defaultUrl = this.config.imageUrl || 'https://flow.google';
    const targetUrl = savedUrl || defaultUrl;
    logger.info('Abrindo Flow.', { targetUrl });
    
    const currentUrl = page.url();
    const currentProjectUrl = normalizeFlowProjectUrl(currentUrl);
    const currentUrlWithoutQuery = currentUrl.split(/[?#]/)[0];
    const isCurrentUrlProjectRoot = Boolean(currentProjectUrl && currentUrlWithoutQuery === currentProjectUrl);
    if (!isCurrentUrlProjectRoot || (savedUrl && currentProjectUrl !== savedUrl)) {
      logger.info('Navegando para Google Flow:', { targetUrl });
      try {
        await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch (navErr) {
        logger.warn(`Falha ao navegar para ${targetUrl}. Tentando URL padrão...`, navErr);
        if (targetUrl !== defaultUrl) {
          await page.goto(defaultUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        } else {
          throw navErr;
        }
      }
    }

    let generationSubmitted = false;
    try {
      // 1. Wait for page load state and settle
      await page.waitForLoadState('domcontentloaded');

      // Detect if we are on the landing page and click "Create with Google Flow" to enter the workspace
      const entryButton = page.getByText(/Create with Google Flow|Criar com o Google Flow|Create with Flow|Criar com o Flow/i).first();

      if (await entryButton.isVisible()) {
        logger.info('Botão "Create with Google Flow" detectado na landing page. Clicando para acessar o workspace...');
        await entryButton.click();
        await page.waitForTimeout(5000);
      } else {
        // Give it a brief moment to check if it appears
        try {
          await entryButton.waitFor({ state: 'visible', timeout: 3000 });
          logger.info('Botão "Create with Google Flow" apareceu após breve espera. Clicando...');
          await entryButton.click();
          await page.waitForTimeout(5000);
        } catch {
          // If not visible, we are likely already inside the workspace/lobby
        }
      }

      logger.info('Aguardando carregamento da interface (lobby ou workspace)...');
      const lobbyBtn = page.locator('button:has-text("Novo projeto"), button:has-text("New project"), button:has-text("add_2")').first();
      const workspaceTextbox = page.locator('[role="textbox"], div[contenteditable="true"]').first();
      
      await Promise.any([
        lobbyBtn.waitFor({ state: 'visible', timeout: 15000 }),
        workspaceTextbox.waitFor({ state: 'visible', timeout: 15000 })
      ]).catch((err) => {
        logger.warn('Aviso: Timeout aguardando os elementos principais da página.', err);
      });

      // 2. Fallback check: If we targeted a saved project URL but ended up redirecting or not landing on a project workspace, navigate to default lobby and create one
      let checkUrl = page.url();
      if (!checkUrl.includes('/project/')) {
        if (savedUrl) {
          logger.warn(`URL salva não carregou um workspace válido (${checkUrl}). Navegando para URL padrão...`);
          await page.goto(defaultUrl, { waitUntil: 'load', timeout: 60000 });
          await page.waitForLoadState('domcontentloaded');
          await Promise.any([
            lobbyBtn.waitFor({ state: 'visible', timeout: 15000 }),
            workspaceTextbox.waitFor({ state: 'visible', timeout: 15000 })
          ]).catch(() => {});
          checkUrl = page.url();
        }

        if (!checkUrl.includes('/project/')) {
          logger.info('Lobby do Google Flow detectado. Tentando criar um novo projeto...');
          if (await lobbyBtn.isVisible()) {
            logger.info('Botão "Novo projeto" localizado. Clicando...');
            await lobbyBtn.click();
            // Wait for workspace textbox to load
            await workspaceTextbox.waitFor({ state: 'visible', timeout: 20000 }).catch(() => {
              logger.warn('Aviso: Timeout aguardando o workspace carregar após clicar em Novo Projeto.');
            });
          } else {
            logger.warn('Botão "Novo projeto" não está visível na página inicial.');
          }
        }
      }

      // Save the active workspace URL for subsequent runs
      const activeUrl = page.url();
      const activeProjectUrl = normalizeFlowProjectUrl(activeUrl);
      if (activeProjectUrl) {
        if (activeUrl.split(/[?#]/)[0] !== activeProjectUrl) {
          await page.goto(activeProjectUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
        }
        saveProjectUrl(activeProjectUrl);
      }

      if (activeProjectUrl !== this.lastProjectUrl) {
        logger.info(`URL do workspace alterada ou nova sessão detectada: ${activeProjectUrl}. Resetando cache de upload.`);
        this.lastUploadedReferenceImage = null;
        this.lastProjectUrl = activeProjectUrl;
      }

      await this.prepareWorkspaceForOperation(page, options);

      // 3. Switch model mode to Image (Nano Banana) or configure popover options
      const modelBtn = page.locator('button').filter({ hasText: /Veo|Banana|Imagen/ }).first();
      if (await modelBtn.count() > 0 && await modelBtn.isVisible()) {
        const buttonText = await modelBtn.innerText();
        const isVideoActive = /Veo/i.test(buttonText);
        const needsPopoverConfig = isVideoActive || options?.aspectRatio || options?.quantity || options?.model;

        if (needsPopoverConfig) {
          logger.info('Abrindo menu de configurações do modelo...');
          await modelBtn.click();
          await page.waitForTimeout(1000); // Wait for popover to open

          // Select Image tab inside the radix model popover if Video was active
          if (isVideoActive) {
            logger.info('Alternando de modo Vídeo para modo Imagem...');
            const imageTab = page.locator('button[role="tab"]').filter({ hasText: /Imagem|Image/ }).first();
            if (await imageTab.count() > 0 && await imageTab.isVisible()) {
              await imageTab.click();
              await page.waitForTimeout(1000);
            }
          }

          // Select Aspect Ratio if specified
          if (options?.aspectRatio) {
            const ratioStr = options.aspectRatio; // e.g. '16:9'
            const ratioBtn = page.locator('button[role="tab"]').filter({ hasText: ratioStr }).first();
            if (await ratioBtn.count() > 0 && await ratioBtn.isVisible()) {
              await ratioBtn.click();
              logger.info(`Aspect ratio selecionado: ${ratioStr}`);
              await page.waitForTimeout(500);
            } else {
              logger.warn(`Botão para aspect ratio "${ratioStr}" não encontrado ou não visível.`);
            }
          }

          // Select Quantity if specified
          if (options?.quantity) {
            let qtyStr = String(options.quantity); // e.g. '2' or 'x2'
            if (!qtyStr.startsWith('x') && !qtyStr.endsWith('x')) {
              qtyStr = qtyStr === '1' ? '1x' : `x${qtyStr}`;
            }
            const qtyBtn = page.locator('button[role="tab"]').filter({ hasText: qtyStr }).first();
            if (await qtyBtn.count() > 0 && await qtyBtn.isVisible()) {
              await qtyBtn.click();
              logger.info(`Quantidade de imagens selecionada: ${qtyStr}`);
              await page.waitForTimeout(500);
            } else {
              logger.warn(`Botão para quantidade "${qtyStr}" não encontrado ou não visível.`);
            }
          }

          // Select Specific Model if specified
          if (options?.model) {
            const modelName = options.model; // e.g. 'Nano Banana Pro'
            const dropdownSelect = page.locator('[role="dialog"], div[data-radix-popper-content-wrapper]').locator('button').filter({ hasText: /Banana|Veo|Imagen/ }).first();
            if (await dropdownSelect.count() > 0 && await dropdownSelect.isVisible()) {
              await dropdownSelect.click();
              await page.waitForTimeout(1000);

              const modelOption = page.locator('[role="menuitem"], [role="option"], [role="menuitemradio"], button:not([aria-haspopup])').filter({ hasText: modelName }).first();
              if (await modelOption.count() > 0 && await modelOption.isVisible()) {
                await modelOption.click();
                logger.info(`Modelo selecionado no dropdown: ${modelName}`);
                await page.waitForTimeout(1000);
              } else {
                logger.warn(`Opção de modelo "${modelName}" não encontrada no dropdown.`);
                // Press escape to close the dropdown menu
                await page.keyboard.press('Escape');
                await page.waitForTimeout(500);
              }
            }
          }

          // Press Escape to ensure the settings popover is closed
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
        } else {
          logger.info('Modo Imagem já ativo e nenhuma configuração customizada solicitada.');
        }
      }

      // 4. Prepare strict image-only tracking so old media or videos are never downloaded as image output.
      const activeModelText = await page.locator('button').filter({ hasText: /Veo|Banana|Imagen/ }).first().innerText().catch(() => '');
      if (/Veo/i.test(activeModelText) && !/(Banana|Imagen)/i.test(activeModelText)) {
        throw new Error('Google Flow ainda esta em modo Video. A geracao de imagem foi bloqueada para evitar criar ou baixar video por engano.');
      }

      const imageCardSelector = 'img:not([role="dialog"] img):not(aside img)';
      const imageCards = () => page.locator(imageCardSelector);
      const initialImageMarker = 'data-mrchicken-initial-image';
      const getImageIdentity = async (index: number): Promise<string> => {
        return await imageCards().nth(index).evaluate((el) => {
          const image = el as HTMLImageElement;
          const src = image.currentSrc || image.src || image.getAttribute('src') || '';
          if (!src) return '';

          const rect = image.getBoundingClientRect();
          const isLargePreview = (rect.width >= 96 && rect.height >= 96) || (image.naturalWidth >= 256 && image.naturalHeight >= 256);
          const isFlowMedia = /getMediaUrlRedirect|googleusercontent|usercontent\.google|^blob:/i.test(src);
          if (!isFlowMedia && !isLargePreview) return '';

          return src;
        }).catch(() => '');
      };
      const getImageIdentities = async (): Promise<Set<string>> => {
        const cards = imageCards();
        const count = await cards.count();
        const identities = new Set<string>();
        for (let i = 0; i < count; i++) {
          const identity = await getImageIdentity(i);
          if (identity) {
            identities.add(identity);
          }
        }
        return identities;
      };
      const getNewImageIndexes = async (initialIdentities: Set<string>, initialCount: number): Promise<number[]> => {
        const cards = imageCards();
        const count = await cards.count();
        const indexes: number[] = [];
        for (let i = 0; i < count; i++) {
          const isInitialCard = await cards.nth(i).evaluate((el, marker) => {
            return (el as HTMLElement).getAttribute(marker) === 'true';
          }, initialImageMarker).catch(() => i < initialCount);
          if (isInitialCard) {
            continue;
          }

          const identity = await getImageIdentity(i);
          if (identity && !initialIdentities.has(identity)) {
            indexes.push(i);
          }
        }

        return indexes;
      };
      
      let expectedNewItemsCount = 2; // Default for ImageFX
      if (options?.quantity) {
        const qtyStr = String(options.quantity).replace('x', '').replace('1x', '1');
        const parsed = parseInt(qtyStr, 10);
        if (!isNaN(parsed)) {
          expectedNewItemsCount = parsed;
        }
      }
      logger.info(`Esperando gerar ${expectedNewItemsCount} itens.`);

      // 4.5. Upload reference image if provided
      if (options?.referenceImage) {
        const skipUpload = options.useExistingFlowReference === true
          && !options.forceReferenceUpload
          && options.referenceImage === this.lastUploadedReferenceImage;
        await this.uploadReferenceImage(
          page,
          options.referenceImage,
          skipUpload,
          options.useExistingFlowReference,
          options.forceReferenceUpload
        );
        this.lastUploadedReferenceImage = options.referenceImage;
      }

      await imageCards().evaluateAll((images, marker) => {
        images.forEach((image) => (image as HTMLElement).setAttribute(marker, 'true'));
      }, initialImageMarker);
      const initialImageCount = await imageCards().count();
      const initialImageIdentities = await getImageIdentities();
      logger.info(`Imagens existentes no workspace antes da geracao: ${initialImageCount}`);

      // 5. Find prompt input area
      logger.info('Inserindo prompt.');
      const promptQueries: ElementQuery[] = [
        { selector: 'div[role="textbox"]' },
        { selector: 'div[contenteditable="true"]' },
        { role: 'textbox' },
        { selector: '[contenteditable="true"]' },
        { selector: 'textarea' },
        { placeholder: 'descreva' },
        { placeholder: 'describe' }
      ];

      const promptInput = await findSmartElement(page, promptQueries, 15000);
      const tagName = await promptInput.evaluate(el => el.tagName.toLowerCase());
      const className = await promptInput.evaluate(el => el.className);
      logger.info(`Textbox de prompt localizado: tag=${tagName}, class=${className}`);
      await promptInput.focus();
      
      // Clear current content and type prompt
      try {
        logger.info('Preenchendo prompt via locator.fill...');
        await promptInput.fill('');
        await promptInput.fill(prompt);
      } catch (err) {
        logger.warn('Falha ao usar fill. Usando click e teclado virtual...', err);
        await promptInput.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(prompt, { delay: 10 });
      }

      // 6. Execute generation
      logger.info('Iniciando geração.');
      // Locate the button containing the arrow_forward icon
      const submitBtn = page.locator('button').filter({ hasText: 'arrow_forward' }).first();
      await submitBtn.waitFor({ state: 'visible', timeout: 15000 });
      await submitBtn.click();
      generationSubmitted = true;

      // 7. Monitor generation progress and wait for finish
      logger.info('Aguardando conclusão da geração...');

      // Check for content policy errors or invalid prompts
      const errorQueries = [
        'text=unsafe',
        'text=content policy',
        'text=violates',
        'text=invalid prompt',
        'text=cannot generate',
        'text=violou as diretrizes',
        'text=prompt inválido'
      ];
      const assertNoVisibleGenerationError = async () => {
        for (const selector of errorQueries) {
          const errEl = page.locator(selector);
          if (await errEl.count() > 0 && await errEl.first().isVisible()) {
            const errMsg = await errEl.first().innerText();
            throw new Error(`Prompt inválido ou violou diretrizes de conteúdo: ${errMsg}`);
          }
        }
      };

      // Poll until generation finishes (new image items are added after submit)
      let lastCount = 0;
      let lastChangeTime = Date.now();
      const generationStartTime = Date.now();
      const partialSettleMs = expectedNewItemsCount > 1 ? 60000 : 12000;
      const submitReturnSettleMs = expectedNewItemsCount > 1 ? expectedNewItemsCount * 20000 : 15000;

      await pollCondition(
        page,
        async () => {
          await assertNoVisibleGenerationError();

          const currentCount = (await getNewImageIndexes(initialImageIdentities, initialImageCount)).length;
          if (currentCount > lastCount) {
            lastCount = currentCount;
            lastChangeTime = Date.now();
            logger.info(`Nova imagem detectada. Contagem parcial: ${currentCount}`);
          }

          // If we reached the expected count, we are done!
          if (currentCount >= expectedNewItemsCount) {
            logger.info(`Alcancou a quantidade esperada de imagens novas: ${currentCount}`);
            return true;
          }

          // If only part of a multi-image batch arrived, wait longer before accepting a partial result.
          if (currentCount > 0 && Date.now() - lastChangeTime > partialSettleMs) {
            logger.info(`Geracao estabilizada em ${currentCount} imagens novas apos timeout de estabilizacao.`);
            return true;
          }

          // Fallback / Virtual scroll check:
          // If the submit button containing 'arrow_forward' is visible again,
          // and we have waited at least 15 seconds since generation started, we assume generation finished.
          const currentSubmitBtn = page.locator('button').filter({ hasText: 'arrow_forward' }).first();
          if (currentCount > 0 && await currentSubmitBtn.isVisible() && Date.now() - generationStartTime > submitReturnSettleMs) {
            logger.info('Botão de envio ("arrow_forward") está visível novamente. Geração terminada.');
            return true;
          }

          return false;
        },
        'A geração da imagem falhou ou excedeu o tempo limite.',
        timeoutMs,
        2000
      );

      // 8. Open and download only the generated image cards
      logger.info('Geração concluída. Iniciando download de todas as novas imagens...');
      
      const detectedNewImageIndexes = await getNewImageIndexes(initialImageIdentities, initialImageCount);
      const newImageIndexes = detectedNewImageIndexes.slice(0, expectedNewItemsCount);
      const newItemsCount = newImageIndexes.length;
      const finalImageCount = await imageCards().count();
      logger.info(`Total de novas imagens detectadas: ${newItemsCount} (Contagem: ${initialImageCount} -> ${finalImageCount})`);
      if (detectedNewImageIndexes.length > expectedNewItemsCount) {
        logger.warn(`Detectadas ${detectedNewImageIndexes.length} imagens novas, mas o download foi limitado a ${expectedNewItemsCount} para respeitar o pedido.`);
      }

      if (newItemsCount <= 0) {
        throw new Error('Nenhuma imagem nova foi detectada apos a geracao. Download bloqueado para evitar baixar imagens antigas do workspace.');
      }

      const downloadedPaths: string[] = [];
      const downloadedFilenames: string[] = [];
      const pdfPaths: string[] = [];
      const pdfFilenames: string[] = [];
      let primaryPath = '';
      let primaryFilename = '';

      // Loop and download each item
      for (let i = 0; i < newItemsCount; i++) {
        const index = newImageIndexes[i];
        logger.info(`Abrindo visualização da imagem ${i + 1} de ${newItemsCount}...`);
        
        const card = imageCards().nth(index);
        await card.waitFor({ state: 'visible', timeout: 15000 });

        const customFolder = options?.folderName && options?.originalFilename 
          ? `${options.folderName}/${options.originalFilename}` 
          : undefined;
        const customFilename = this.generateImageId();

        let downloadResult: { success: boolean; path: string; filename: string; createdAt: string } | null = null;
        try {
          await card.click({ force: true });
          await page.waitForTimeout(2000); // Settling time for preview overlay

          // Find download button in preview drawer/overlay
          const downloadBtn = page.locator('button').filter({ hasText: /download|baixar/i }).first();
          await downloadBtn.waitFor({ state: 'visible', timeout: 10000 });

          downloadResult = await this.downloader.downloadFile(
            page,
            downloadBtn,
            'image',
            'images',
            '.png',
            customFolder,
            customFilename
          );
        } catch (downloadErr) {
          logger.warn(`Download pelo preview falhou no item ${i + 1}. Tentando fallback direto do card.`, downloadErr);
          downloadResult = await this.saveImageCardFallback(card, options, customFilename);
        }

        if (downloadResult?.success) {
          downloadedPaths.push(downloadResult.path);
          downloadedFilenames.push(downloadResult.filename);
          if (i === 0) {
            primaryPath = downloadResult.path;
            primaryFilename = downloadResult.filename;
          }
          logger.info(`Download do item ${i + 1} concluído: ${downloadResult.filename}`);

          // Convert image to high quality PDF
          try {
            const pdfPath = downloadResult.path.replace(/\.[^/.]+$/, "") + ".pdf";
            await convertImageToPdf(downloadResult.path, pdfPath);
            pdfPaths.push(pdfPath);
            pdfFilenames.push(path.basename(pdfPath));
          } catch (pdfErr) {
            logger.error(`Falha ao converter estampa ${i + 1} para PDF:`, pdfErr);
          }
        } else {
          logger.warn(`Falha ao realizar download do item ${i + 1}`);
        }

        // Close preview overlay
        logger.info(`Fechando painel de visualização do item ${i + 1}.`);
        await page.keyboard.press('Escape');
        
        // Wait for preview to close fully
        await page.locator('button').filter({ hasText: /download|baixar/i }).first().waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500); // Wait for transition to settle
      }

      if (downloadedPaths.length === 0) {
        throw new Error('As imagens foram geradas, mas nenhuma foi baixada com sucesso apos falha de coleta/download.');
      }

      return {
        success: true,
        submitted: true,
        path: primaryPath,
        filename: primaryFilename,
        paths: downloadedPaths,
        filenames: downloadedFilenames,
        pdfPaths: pdfPaths,
        pdfFilenames: pdfFilenames,
        createdAt: new Date().toISOString()
      };

    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('Erro encontrado durante a geração da imagem:', error);
      
      // Capture error screenshot for debugging
      try {
        ensureDirExists('storage/generated/');
        const screenshotPath = 'storage/generated/error_image_generator.png';
        await page.screenshot({ path: screenshotPath });
        logger.info(`Screenshot de erro salvo em: ${screenshotPath}`);
      } catch (screenshotErr) {
        logger.warn('Falha ao capturar screenshot de erro.', screenshotErr);
      }

      // Attempt to close preview modal in case of error
      await page.keyboard.press('Escape').catch(() => {});
      
      return {
        success: false,
        submitted: generationSubmitted,
        path: '',
        filename: '',
        createdAt: new Date().toISOString(),
        error: errMsg
      };
    }
  }
}
