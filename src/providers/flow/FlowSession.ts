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
    await page.goto(this.config.flowUrl, { waitUntil: 'load', timeout: 60000 });

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
      await page.goto(this.config.flowUrl, { waitUntil: 'load', timeout: 60000 });
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
      await page.goto(this.config.flowUrl, { waitUntil: 'load', timeout: 60000 });
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
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-web-security'
      ],
      acceptDownloads: true
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
      // 1. Check if we are redirected to a Google accounts sign-in URL
      const currentUrl = page.url();
      if (currentUrl.includes('accounts.google.com')) {
        return false;
      }

      // 2. Check for explicit Sign In buttons on the page
      const signInBtn = page.locator('button:has-text("Sign in"), button:has-text("Fazer login"), a:has-text("Sign in"), a:has-text("Fazer login"), [aria-label*="Sign in"], [aria-label*="Fazer login"]');
      const count = await signInBtn.count();
      for (let i = 0; i < count; i++) {
        if (await signInBtn.nth(i).isVisible()) {
          return false;
        }
      }

      // 3. Check for typical profile indicators or logged-in markers
      const profileIndicators = [
        'img[src*="googleusercontent"]',
        '[aria-label*="Google Account"]',
        '[aria-label*="Conta do Google"]',
        'button[aria-label*="profile"]',
        '.profile-photo',
        // Also if we see creation/prompt elements, we are logged in
        'textarea',
        '[placeholder*="prompt"]',
        '[placeholder*="descreva"]',
        '[placeholder*="describe"]'
      ];

      for (const selector of profileIndicators) {
        const locator = page.locator(selector);
        const locCount = await locator.count();
        for (let i = 0; i < locCount; i++) {
          if (await locator.nth(i).isVisible()) {
            return true;
          }
        }
      }

      return false;
    } catch (error) {
      logger.error('Erro ao verificar autenticação:', error);
      return false;
    }
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
