import * as path from 'path';
import { Page, Locator } from 'playwright';
import { logger, ensureDirExists, generateFilename } from './FlowUtils';

export class FlowDownloader {
  constructor(private downloadRootPath: string) {
    // Ensure download root exists
    ensureDirExists(path.resolve(this.downloadRootPath));
  }

  /**
   * Triggers a download by clicking the triggerLocator and saves the downloaded file with a UUID name.
   * 
   * @param page The Playwright Page instance.
   * @param triggerLocator The locator pointing to the button or element that triggers the download.
   * @param prefix Prefix for the UUID filename (e.g. 'image', 'video').
   * @param subfolder Target subfolder under the download root (e.g. 'images', 'videos').
   * @param defaultExt Fallback file extension if unable to determine from download metadata.
   */
  async downloadFile(
    page: Page,
    triggerLocator: Locator,
    prefix: 'image' | 'video',
    subfolder: 'images' | 'videos',
    defaultExt: string
  ): Promise<{ success: boolean; path: string; filename: string; createdAt: string }> {
    logger.info('Download iniciado.');

    try {
      // Set up the download listener before clicking
      const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
      
      // Click the download button
      await triggerLocator.click();

      // Wait for the download process to complete
      const download = await downloadPromise;

      // Determine extension
      const suggestedFilename = download.suggestedFilename();
      const ext = path.extname(suggestedFilename) || defaultExt;

      // Generate clean UUID filename
      const filename = generateFilename(prefix, ext);
      const targetDir = path.resolve(this.downloadRootPath, subfolder);
      ensureDirExists(targetDir);

      const targetPath = path.join(targetDir, filename);

      // Save the downloaded file to its destination
      await download.saveAs(targetPath);
      
      logger.info('Download concluído.', { filename, targetPath });
      logger.info('Arquivo salvo.', { path: targetPath });

      return {
        success: true,
        path: targetPath,
        filename: filename,
        createdAt: new Date().toISOString()
      };
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      logger.error('Erro encontrado durante o download:', error);
      throw new Error(`Falha no download: ${errMsg}`);
    }
  }
}
