import { Page } from 'playwright';
import { ImageGenerationResult, FlowConfig, ImageGenerationOptions } from './FlowTypes';
import { logger, findSmartElement, ElementQuery, pollCondition, getSavedProjectUrl, saveProjectUrl, ensureDirExists } from './FlowUtils';
import { FlowDownloader } from './FlowDownloader';
export class FlowImageGenerator {
  constructor(private downloader: FlowDownloader, private config: FlowConfig) {}

  /**
   * Uploads a reference image to the workspace.
   */
  private async uploadReferenceImage(page: Page, referenceImage: string): Promise<void> {
    logger.info(`Upload de imagem de referência solicitado: ${referenceImage}`);
    const fileInput = page.locator('input[type="file"]').first();
    try {
      await fileInput.waitFor({ state: 'attached', timeout: 15000 });
      logger.info('Input de arquivo de referência localizado. Fazendo upload...');
      await fileInput.setInputFiles(referenceImage);
      logger.info('Arquivo enviado. Aguardando 5 segundos para processamento do upload...');
      await page.waitForTimeout(5000);

      logger.info('Abrindo menu de mídia do prompt...');
      const promptPlusBtn = page.locator('button').filter({ hasText: 'add_2' }).first();
      await promptPlusBtn.waitFor({ state: 'visible', timeout: 10000 });
      await promptPlusBtn.click();
      await page.waitForTimeout(2000);

      logger.info('Localizando caixa de diálogo de recursos...');
      const dialog = page.locator('[role="dialog"], [role="menu"], [data-state="open"]').filter({ hasText: 'Incluir no comando' }).first();
      await dialog.waitFor({ state: 'visible', timeout: 15000 });

      // We do not fill the searchInput to avoid search behavior or issues since Google Flow
      // truncates long filenames with an ellipsis in the UI list items.
      // Since the uploaded file is the most recent, it sits at the top under "Recentes".
      // We directly locate the item containing the prefix "ref_image_".
      logger.info('Selecionando o recurso mais recente na lista...');
      const item = dialog.locator('text=ref_image_').filter({ visible: true }).first();
      await item.waitFor({ state: 'visible', timeout: 15000 });
      await item.click();
      await page.waitForTimeout(1000);

      logger.info('Confirmando inclusão da imagem no comando...');
      const includeBtn = dialog.locator('button:has-text("Incluir no comando"), button:has-text("Include in prompt"), button:has-text("Incluir")').first();
      if (await includeBtn.isVisible()) {
        await includeBtn.click();
        logger.info('Botão de inclusão clicado.');
      } else {
        logger.info('Botão de inclusão não visível (imagem anexada automaticamente).');
      }
      
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
    const isCurrentUrlProject = currentUrl.includes('/project/');
    if (!isCurrentUrlProject || (savedUrl && !currentUrl.includes(savedUrl))) {
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
      if (activeUrl.includes('/project/')) {
        saveProjectUrl(activeUrl);
      }

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
          const identity = await getImageIdentity(i);
          if (identity && !initialIdentities.has(identity)) {
            indexes.push(i);
          }
        }

        const countDelta = Math.max(0, count - initialCount);
        if (countDelta > indexes.length) {
          for (let i = initialCount; i < count; i++) {
            if (!indexes.includes(i)) {
              indexes.push(i);
            }
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
        await this.uploadReferenceImage(page, options.referenceImage);
      }

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
      
      const newImageIndexes = await getNewImageIndexes(initialImageIdentities, initialImageCount);
      const newItemsCount = newImageIndexes.length;
      const finalImageCount = await imageCards().count();
      logger.info(`Total de novas imagens detectadas: ${newItemsCount} (Contagem: ${initialImageCount} -> ${finalImageCount})`);

      if (newItemsCount <= 0) {
        throw new Error('Nenhuma imagem nova foi detectada apos a geracao. Download bloqueado para evitar baixar imagens antigas do workspace.');
      }

      const downloadedPaths: string[] = [];
      const downloadedFilenames: string[] = [];
      let primaryPath = '';
      let primaryFilename = '';

      // Loop and download each item
      for (let i = 0; i < newItemsCount; i++) {
        const index = newImageIndexes[i];
        logger.info(`Abrindo visualização da imagem ${i + 1} de ${newItemsCount}...`);
        
        const card = imageCards().nth(index);
        await card.waitFor({ state: 'visible', timeout: 15000 });
        await card.click({ force: true });
        await page.waitForTimeout(2000); // Settling time for preview overlay

        // Find download button in preview drawer/overlay
        const downloadBtn = page.locator('button').filter({ hasText: /download|baixar/i }).first();
        await downloadBtn.waitFor({ state: 'visible', timeout: 10000 });

        logger.info(`Iniciando download do item ${i + 1}...`);
        const downloadResult = await this.downloader.downloadFile(
          page,
          downloadBtn,
          'image',
          'images',
          '.png'
        );

        if (downloadResult.success) {
          downloadedPaths.push(downloadResult.path);
          downloadedFilenames.push(downloadResult.filename);
          if (i === 0) {
            primaryPath = downloadResult.path;
            primaryFilename = downloadResult.filename;
          }
          logger.info(`Download do item ${i + 1} concluído: ${downloadResult.filename}`);
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
        throw new Error('Nenhuma imagem foi baixada com sucesso.');
      }

      return {
        success: true,
        path: primaryPath,
        filename: primaryFilename,
        paths: downloadedPaths,
        filenames: downloadedFilenames,
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
        path: '',
        filename: '',
        createdAt: new Date().toISOString(),
        error: errMsg
      };
    }
  }
}
