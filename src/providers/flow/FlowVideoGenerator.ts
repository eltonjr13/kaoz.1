import { Page, Locator } from 'playwright';
import { VideoGenerationResult } from './FlowTypes';
import { logger, findSmartElement, ElementQuery, pollCondition } from './FlowUtils';
import { FlowDownloader } from './FlowDownloader';
import { probeMediaInfo } from '@/lib/videos/render';

export class FlowVideoGenerator {
  constructor(private downloader: FlowDownloader) {}

  /**
   * Generates a video using Google Flow / VideoFX.
   */
  async generate(page: Page, prompt: string, timeoutMs: number): Promise<VideoGenerationResult> {
    logger.info('Abrindo Flow.');
    
    // Check if we need to navigate specifically to the video tool
    const currentUrl = page.url();
    if (!currentUrl.includes('/video') && !currentUrl.includes('/fx/tools/video')) {
      logger.info('Navegando para ferramenta de vídeo.');
      // Navigation would occur here if specialized sub-urls are configured.
    }

    try {
      // 1. Wait for page load state
      await page.waitForLoadState('domcontentloaded');

      // 2. Inserir prompt
      logger.info('Inserindo prompt.');
      const promptQueries: ElementQuery[] = [
        { selector: 'textarea' },
        { selector: '[contenteditable="true"]' },
        { placeholder: 'descreva' },
        { placeholder: 'describe' },
        { placeholder: 'prompt' },
        { role: 'textbox', placeholder: 'what would you like' },
        { role: 'textbox' }
      ];

      const promptInput = await findSmartElement(page, promptQueries, 15000);
      await promptInput.focus();
      
      // Clear current content
      await promptInput.fill('');
      // Type prompt
      await promptInput.fill(prompt);

      // 3. Executar geração
      logger.info('Iniciando geração.');
      const submitQueries: ElementQuery[] = [
        { role: 'button', text: 'Generate' },
        { role: 'button', text: 'Create' },
        { role: 'button', text: 'Gerar' },
        { role: 'button', text: 'Submit' },
        { selector: 'button[type="submit"]' },
        { selector: 'button:has(svg)' },
        { role: 'button', ariaLabel: 'Generate' }
      ];

      const submitBtn = await findSmartElement(page, submitQueries, 10000);
      await submitBtn.click();

      // 4. Monitorar progresso e Esperar conclusão
      logger.info('Aguardando.');

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

      // Poll until generation finishes (download button is visible) or error is found
      const downloadQueries: ElementQuery[] = [
        { role: 'button', text: 'Download' },
        { role: 'button', text: 'Baixar' },
        { selector: 'button[aria-label*="download"]' },
        { selector: 'a[download]' },
        { selector: '[aria-label*="Download"]' }
      ];

      let downloadButton: Locator | null = null;

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

          // Check if generation completed by looking for download button
          for (const query of downloadQueries) {
            try {
              let locator = null;
              if (query.selector) {
                locator = page.locator(query.selector);
              } else if (query.text) {
                locator = page.getByRole(query.role || 'button', { name: query.text, exact: false });
              }
              if (locator && await locator.count() > 0 && await locator.first().isVisible()) {
                downloadButton = locator.first();
                return true;
              }
            } catch {
              // ignore locator errors
            }
          }
          return false;
        },
        'A geração do vídeo falhou ou excedeu o tempo limite.',
        timeoutMs,
        3000
      );

      if (!downloadButton) {
        throw new Error('Botão de download não pôde ser localizado após a geração.');
      }

      // 5. Baixar vídeo
      logger.info('Download iniciado.');
      const downloadResult = await this.downloader.downloadFile(
        page,
        downloadButton,
        'video',
        'videos',
        '.mp4'
      );

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
