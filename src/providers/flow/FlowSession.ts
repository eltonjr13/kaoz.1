import * as path from 'path';
import { chromium, BrowserContext, Page } from 'playwright';
import { FlowConfig } from './FlowTypes';
import { logger, ensureDirExists } from './FlowUtils';

export class FlowSession {
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;

  constructor(private config: FlowConfig) {
    // Ensure profile path exists
    ensureDirExists(path.resolve(this.config.profilePath));
  }

  /**
   * Returns the active Playwright page, launching it if necessary.
   */
  async getPage(): Promise<Page> {
    if (this.activePage && !this.activePage.isClosed()) {
      return this.activePage;
    }
    return this.launch();
  }

  /**
   * Launches the persistent browser session.
   */
  private async launch(): Promise<Page> {
    logger.info('Sessão iniciada.');
    
    // Launch standard configured headlessness (could be headless: true)
    let page = await this.launchContext(this.config.headless);
    
    logger.info('Abrindo Flow.');
    await page.goto(this.config.flowUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    const authenticated = await this.checkAuthenticated(page);
    if (authenticated) {
      logger.info('Sessão autenticada e pronta.');
      this.activePage = page;
      return page;
    }

    // If not authenticated, we need manual login
    logger.warn('Sessão expirada ou não autenticada. Login manual necessário.');
    
    if (this.config.headless) {
      logger.info('Fechando navegador em modo headless para iniciar login manual.');
      await this.close();

      logger.info('Abrindo navegador headful (visível) para login manual. Por favor, faça login na sua Conta Google.');
      page = await this.launchContext(false);
      await page.goto(this.config.flowUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    // Wait for manual login to complete
    const loggedIn = await this.waitForManualLogin(page);
    if (!loggedIn) {
      await this.close();
      throw new Error('Falha no login manual: Timeout ou navegador fechado antes da conclusão.');
    }

    logger.info('Login manual concluído com sucesso.');

    // If we originally wanted headless mode, close the headful browser and relaunch headlessly
    if (this.config.headless) {
      logger.info('Re-iniciando em modo headless...');
      await this.close();
      page = await this.launchContext(true);
      await page.goto(this.config.flowUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    }

    this.activePage = page;
    return page;
  }

  /**
   * Helper to launch the browser context.
   */
  private async launchContext(headless: boolean): Promise<Page> {
    const absoluteProfilePath = path.resolve(this.config.profilePath);
    
    this.context = await chromium.launchPersistentContext(absoluteProfilePath, {
      headless: headless,
      viewport: { width: 1280, height: 720 },
      ignoreDefaultArgs: ['--enable-automation'],
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security',
        '--disable-blink-features=AutomationControlled'
      ],
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      acceptDownloads: true
    });

    // Mask the navigator.webdriver property to bypass anti-bot detections
    await this.context.addInitScript(() => {
      Object.defineProperty(navigator, 'webdriver', {
        get: () => undefined,
      });
    });

    // Handle context-level errors
    this.context.on('close', () => {
      logger.info('Sessão encerrada (Browser Context fechado).');
      this.context = null;
      this.activePage = null;
    });

    const pages = this.context.pages();
    const page = pages.length > 0 ? pages[0] : await this.context.newPage();
    return page;
  }

  /**
   * Checks if the current page has active authentication.
   */
  async checkAuthenticated(page: Page): Promise<boolean> {
    try {
      const url = page.url();
      if (url.includes('accounts.google.com') || url.includes('signin')) {
        logger.info('URL de login do Google detectada. Não autenticado.');
        return false;
      }
      return await this.pollAuthStatus(page);
    } catch (error) {
      logger.error('Erro ao verificar autenticação:', error);
      return false;
    }
  }

  /**
   * Helper method to poll for authentication status elements on the page.
   */
  private async pollAuthStatus(page: Page): Promise<boolean> {
    const loggedInLocator = page.locator(
      'button:has-text("Novo projeto"), button:has-text("New project"), button:has-text("add_2"), div[contenteditable="true"]'
    ).first();
    
    const loggedOutLocator = page.locator(
      'button:has-text("Sign in"), button:has-text("Fazer login"), a:has-text("Sign in"), a:has-text("Fazer login")'
    ).first();

    for (let i = 0; i < 5; i++) {
      const currentUrl = page.url();
      if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
        return false;
      }
      if (await loggedInLocator.isVisible()) {
        logger.info('Elemento de workspace ou criação detectado. Autenticado.');
        return true;
      }
      if (await loggedOutLocator.isVisible()) {
        logger.info('Botão de login detectado. Não autenticado.');
        return false;
      }
      await page.waitForTimeout(2000);
    }

    const finalUrl = page.url();
    return finalUrl.includes('/project/');
  }

  /**
   * Waits up to 5 minutes for the user to manually log in.
   */
  private async waitForManualLogin(page: Page): Promise<boolean> {
    const timeoutMs = 300000; // 5 minutes
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
      if (page.isClosed()) {
        return false;
      }

      const authenticated = await this.checkAuthenticated(page);
      if (authenticated) {
        return true;
      }

      // Sleep 2 seconds before checking again
      await page.waitForTimeout(2000);
    }

    return false;
  }

  /**
   * Returns current session status.
   */
  async getStatus(): Promise<{ initialized: boolean; authenticated: boolean; activeTasks: number }> {
    const initialized = this.context !== null && this.activePage !== null && !this.activePage.isClosed();
    let authenticated = false;
    if (initialized && this.activePage) {
      authenticated = await this.checkAuthenticated(this.activePage);
    }
    return {
      initialized,
      authenticated,
      activeTasks: 0 // Will be managed by the main provider
    };
  }

  /**
   * Closes the current browser and context.
   */
  async close(): Promise<void> {
    if (this.context) {
      try {
        await this.context.close();
      } catch (err) {
        logger.error('Erro ao fechar o browser context:', err);
      } finally {
        this.context = null;
        this.activePage = null;
      }
    }
  }
}
