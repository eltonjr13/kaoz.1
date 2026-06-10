import { Page, Locator } from 'playwright';
import { VideoGenerationResult, FlowConfig } from './FlowTypes';
import { logger, findSmartElement, ElementQuery, pollCondition } from './FlowUtils';
import { FlowDownloader } from './FlowDownloader';
import { probeMediaInfo } from '@/lib/videos/render';

export class FlowVideoGenerator {
  constructor(private downloader: FlowDownloader, private config: FlowConfig) {}

  /**
   * Generates a video using Google Flow.
   */
  async generate(page: Page, prompt: string, timeoutMs: number): Promise<VideoGenerationResult> {
    const targetUrl = this.config.videoUrl || 'https://flow.google';
    logger.info('Abrindo Flow.');
    
    const currentUrl = page.url();
    if (!currentUrl.includes('/project/') && !currentUrl.includes('/tools/flow')) {
      logger.info('Navegando para Google Flow:', { targetUrl });
      await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 });
    }

    try {
      // 1. Wait for page load state and settle
      await page.waitForLoadState('domcontentloaded');

      logger.info('Aguardando carregamento da interface (lobby ou workspace)...');
      const lobbyBtn = page.locator('button:has-text("Novo projeto"), button:has-text("New project"), button:has-text("add_2")').first();
      const workspaceTextbox = page.locator('[role="textbox"], div[contenteditable="true"]').first();
      
      await Promise.any([
        lobbyBtn.waitFor({ state: 'visible', timeout: 15000 }),
        workspaceTextbox.waitFor({ state: 'visible', timeout: 15000 })
      ]).catch((err) => {
        logger.warn('Aviso: Timeout aguardando os elementos principais da página.', err);
      });

      // 2. Click "Novo projeto" if on lobby page
      const checkUrl = page.url();
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

      // 3. Switch model mode to Video (Veo) if Image (Nano Banana) is active
      const modelBtn = page.locator('button').filter({ hasText: /Veo|Banana/ }).first();
      if (await modelBtn.count() > 0 && await modelBtn.isVisible()) {
        const buttonText = await modelBtn.innerText();
        if (buttonText.includes('Banana')) {
          logger.info('Modo Imagem (Nano Banana) ativo no workspace. Alternando para modo Vídeo...');
          await modelBtn.click();
          await page.waitForTimeout(1000); // Wait for popup to open

          // Click Video tab inside the radix model popover
          const videoTab = page.locator('button[role="tab"]').filter({ hasText: /Vídeo|Video/ }).first();
          if (await videoTab.count() > 0 && await videoTab.isVisible()) {
            await videoTab.click();
            logger.info('Aba de Vídeo selecionada com sucesso.');
            await page.waitForTimeout(1000);
          } else {
            logger.warn('Aba de Vídeo não localizada no menu de modelos.');
          }

          // Press Escape to ensure the popover is closed
          await page.keyboard.press('Escape');
          await page.waitForTimeout(500);
        } else {
          logger.info('Modo Vídeo (Veo) já está ativo no workspace.');
        }
      }

      // 4. Count initial generated items (to detect when a new one is finished)
      const getMediaCount = async () => {
        const imgCount = await page.locator('img[src*="getMediaUrlRedirect"]').count();
        const videoCount = await page.locator('video').count();
        return imgCount + videoCount;
      };
      
      const initialMediaCount = await getMediaCount();
      logger.info(`Itens de mídia existentes no workspace: ${initialMediaCount}`);

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
        await promptInput.click();
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');
        await page.keyboard.type(prompt, { delay: 10 });
      } catch (err) {
        logger.warn('Falha ao usar teclado virtual para digitar. Usando preenchimento padrão (fill).', err);
        await promptInput.fill('');
        await promptInput.fill(prompt);
      }

      // 6. Execute generation
      logger.info('Iniciando geração.');
      // Locate the button containing the arrow_forward icon
      const submitBtn = page.locator('button').filter({ hasText: 'arrow_forward' }).first();
      await submitBtn.waitFor({ state: 'visible', timeout: 15000 });
      await submitBtn.click();

      // 7. Monitor generation progress and wait for finish
      logger.info('Aguardando conclusão da geração...');

      // Check for content policy errors or invalid prompts during wait
      const errorQueries = [
        'text=unsafe',
        'text=content policy',
        'text=violates',
        'text=invalid prompt',
        'text=cannot generate',
        'text=violou as diretrizes',
        'text=prompt inválido'
      ];

      // Poll until generation finishes (new media item is added to the count)
      await pollCondition(
        page,
        async () => {
          // Check for errors first
          for (const selector of errorQueries) {
            const errEl = page.locator(selector);
            if (await errEl.count() > 0 && await errEl.first().isVisible()) {
              const errMsg = await errEl.first().innerText();
              throw new Error(`Prompt inválido ou violou diretrizes de conteúdo: ${errMsg}`);
            }
          }

          const currentCount = await getMediaCount();
          return currentCount > initialMediaCount;
        },
        'A geração do vídeo falhou ou excedeu o tempo limite.',
        timeoutMs,
        3000
      );

      // 8. Open the generated media card preview
      logger.info('Geração concluída. Abrindo visualização da mídia...');
      const newMediaCard = page.locator('img[src*="getMediaUrlRedirect"], video').first();
      await newMediaCard.waitFor({ state: 'visible', timeout: 10000 });
      await newMediaCard.click();
      await page.waitForTimeout(2000); // Settling time for preview overlay

      // 9. Find download button in preview drawer/overlay
      const downloadBtn = page.locator('button').filter({ hasText: /download|baixar/i }).first();
      await downloadBtn.waitFor({ state: 'visible', timeout: 10000 });

      // 10. Download video file
      logger.info('Download iniciado.');
      const downloadResult = await this.downloader.downloadFile(
        page,
        downloadBtn,
        'video',
        'videos',
        '.mp4'
      );

      // 11. Close preview overlay
      logger.info('Fechando painel de visualização.');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(500);

      // Determine video duration using ffprobe
      let durationStr = '0.00';
      try {
        const mediaInfo = await probeMediaInfo(downloadResult.path);
        if (mediaInfo.duration) {
          durationStr = mediaInfo.duration.toFixed(2);
        }
      } catch (probeErr) {
        logger.warn('Não foi possível obter a duração do vídeo usando ffprobe, definindo fallback como 6.00', probeErr);
        durationStr = '6.00'; // Default fallback duration for VideoFX videos
      }

      return {
        success: true,
        path: downloadResult.path,
        filename: downloadResult.filename,
        duration: durationStr,
        createdAt: downloadResult.createdAt
      };

    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('Erro encontrado durante a geração do vídeo:', error);
      
      // Attempt to close preview modal in case of error
      await page.keyboard.press('Escape').catch(() => {});
      
      return {
        success: false,
        path: '',
        filename: '',
        duration: '0.00',
        createdAt: new Date().toISOString(),
        error: errMsg
      };
    }
  }
}
