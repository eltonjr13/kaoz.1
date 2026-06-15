import * as path from 'path';
import { chromium, BrowserContext, Page } from 'playwright';
import { FlowConfig, FlowPortal, PortalLoginResult } from './FlowTypes';
import { logger, ensureDirExists } from './FlowUtils';

export class FlowSession {
  private context: BrowserContext | null = null;
  private activePage: Page | null = null;
  private loginInProgress = false;

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
   * Returns a browser page for external LLM portals without forcing Google Flow auth first.
   */
  async getAutomationPage(): Promise<Page> {
    if (this.activePage && !this.activePage.isClosed()) {
      return this.activePage;
    }

    const page = await this.launchContext(this.config.headless);
    this.activePage = page;
    return page;
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

    const launchOptions: Parameters<typeof chromium.launchPersistentContext>[1] = {
      headless: headless,
      viewport: { width: 1280, height: 720 },
      acceptDownloads: true
    };

    if (this.config.browserChannel) {
      launchOptions.channel = this.config.browserChannel;
    }

    try {
      this.context = await chromium.launchPersistentContext(absoluteProfilePath, launchOptions);
    } catch (err) {
      if (!this.config.browserChannel) {
        throw err;
      }

      logger.warn(
        `Falha ao iniciar navegador no canal ${this.config.browserChannel}. Tentando Chromium padrao.`,
        err
      );
      const fallbackOptions = { ...launchOptions };
      delete fallbackOptions.channel;
      this.context = await chromium.launchPersistentContext(absoluteProfilePath, fallbackOptions);
    }

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
    
    const loggedOutLocator = page.getByText(/Sign in|Fazer login/i).first();

    const entryButton = page.getByText(/Create with Google Flow|Criar com o Google Flow|Create with Flow|Criar com o Flow/i).first();

    for (let i = 0; i < 5; i++) {
      const currentUrl = page.url();
      if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
        logger.info('URL de login ou contas do Google detectada.');
        return false;
      }
      
      // If we see the landing page entry button, click it to enter workspace
      if (await entryButton.isVisible()) {
        logger.info('Botão de entrada "Create with Google Flow" localizado. Clicando...');
        await entryButton.click();
        await page.waitForTimeout(4000);
        continue;
      }

      if (await loggedInLocator.isVisible() || currentUrl.includes('/project/')) {
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
   * Launches a headful browser session for manual login to the specified portal,
   * keeping it open until the user closes the window.
   */
  /**
   * Launches a headful browser session for manual login to the specified portal,
   * keeping it open until either successful authentication is detected, or the user closes the window.
   */
  async openLoginSession(portal: FlowPortal): Promise<PortalLoginResult> {
    logger.info(`Abrindo sessão de login visível para: ${portal}`);

    if (this.loginInProgress) {
      return {
        portal,
        authenticated: false,
        reason: 'error',
        message: 'Ja existe uma sessao de login manual em andamento.'
      };
    }

    this.loginInProgress = true;

    try {
    
    // 1. Close any existing context to release the lock on the profile
    await this.close();

    // 2. Resolve target portal URL
    let targetUrl = 'https://labs.google/fx/pt/tools/flow/';
    if (portal === 'gemini') {
      targetUrl = 'https://gemini.google.com';
    } else if (portal === 'chatgpt') {
      targetUrl = 'https://chatgpt.com';
    } else if (portal === 'claude') {
      targetUrl = 'https://claude.ai';
    } else if (portal === 'deepseek') {
      targetUrl = 'https://chat.deepseek.com';
    }

    // 3. Launch headful browser context
    const page = await this.launchContext(false);
    logger.info(`Navegando para o portal de login: ${targetUrl}`);
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });

    // 4. Wait for the browser context to be closed by the user or authentication to be detected
    return await new Promise<PortalLoginResult>((resolve) => {
      let resolved = false;
      let authenticatedDetected = false;
      let checkInterval: NodeJS.Timeout | null = null;
      let timeoutHandle: NodeJS.Timeout | null = null;

      const finish = (result: PortalLoginResult) => {
        if (resolved) return;
        resolved = true;
        if (checkInterval) {
          clearInterval(checkInterval);
        }
        if (timeoutHandle) {
          clearTimeout(timeoutHandle);
        }
        resolve(result);
      };

      if (!this.context) {
        finish({
          portal,
          authenticated: false,
          reason: 'error',
          message: `Navegador de login para ${portal} nao foi inicializado.`
        });
        return;
      }

      this.context.once('close', () => {
        logger.info(`Sessão de login para ${portal} concluída (Browser Context fechado).`);
        if (authenticatedDetected) {
          finish({
            portal,
            authenticated: true,
            reason: 'detected',
            message: `Login em ${portal} detectado e sessao salva no perfil do Playwright.`
          });
          return;
        }
        finish({
          portal,
          authenticated: false,
          reason: 'closed',
          message: `A janela de login para ${portal} foi fechada antes de a autenticacao ser detectada.`
        });
      });

      page.once('close', async () => {
        logger.info(`Página de login para ${portal} fechada pelo usuário.`);
        if (resolved) {
          return;
        }
        if (authenticatedDetected) {
          finish({
            portal,
            authenticated: true,
            reason: 'detected',
            message: `Login em ${portal} detectado e sessao salva no perfil do Playwright.`
          });
          await this.close();
          return;
        }
        finish({
          portal,
          authenticated: false,
          reason: 'closed',
          message: `A pagina de login para ${portal} foi fechada antes de a autenticacao ser detectada.`
        });
        await this.close();
      });

      timeoutHandle = setTimeout(() => {
        logger.warn(`Timeout aguardando login no portal ${portal}.`);
        if (authenticatedDetected) {
          finish({
            portal,
            authenticated: true,
            reason: 'detected',
            message: `Login em ${portal} detectado e sessao salva no perfil do Playwright.`
          });
          return;
        }
        finish({
          portal,
          authenticated: false,
          reason: 'timeout',
          message: `Tempo limite aguardando login em ${portal}. Abra novamente e conclua o login antes de fechar a janela.`
        });
        void this.close();
      }, this.config.timeout);

      // Poll every 2 seconds to check if authenticated
      checkInterval = setInterval(async () => {
        if (resolved || page.isClosed()) {
          if (checkInterval) {
            clearInterval(checkInterval);
          }
          return;
        }

        try {
          const authenticated = await this.checkPortalAuthenticated(page, portal);
          if (authenticated) {
            if (!authenticatedDetected) {
              authenticatedDetected = true;
              logger.info(`Login detectado para o portal ${portal}. Aguardando o usuario fechar a janela para concluir.`);
            }
          }
        } catch {
          // Ignore errors during polling (e.g. navigation or closed page)
        }
      }, 2000);
    });
    } catch (err) {
      logger.error(`Falha ao abrir sessao de login para ${portal}:`, err);
      const message = err instanceof Error ? err.message : String(err);
      return {
        portal,
        authenticated: false,
        reason: 'error',
        message
      };
    } finally {
      this.loginInProgress = false;
    }
  }

  /**
   * Helper method to verify authentication for a specific portal during the login session.
   */
  // eslint-disable-next-line complexity
  private async checkPortalAuthenticated(
    page: Page,
    portal: FlowPortal
  ): Promise<boolean> {
    try {
      const url = page.url();

      if (
        url.includes('accounts.google.com') ||
        url.includes('signin') ||
        url.includes('sign_in') ||
        url.includes('sign-in') ||
        url.includes('/login') ||
        url.includes('/auth') ||
        url.includes('/signup') ||
        url.includes('/sign-up')
      ) {
        return false;
      }

      if (portal === 'google') {
        const loggedInLocator = page.locator('button:has-text("Novo projeto"), button:has-text("New project"), button:has-text("add_2")').first();
        if (await loggedInLocator.isVisible() || url.includes('/project/')) {
          return true;
        }
        
        // Also handle the landing page entry button
        const entryButton = page.getByText(/Create with Google Flow|Criar com o Google Flow|Create with Flow|Criar com o Flow/i).first();
        if (await entryButton.isVisible()) {
          logger.info('Botão de entrada "Create with Google Flow" localizado durante o login. Clicando...');
          await entryButton.click();
          await page.waitForTimeout(3000);
        }
        return false;
      }

      if (portal === 'gemini') {
        if (!url.includes('/app')) {
          return false;
        }
        const promptArea = page.locator('div[contenteditable="true"], textarea[placeholder*="Gemini"], chat-input').first();
        return await promptArea.isVisible();
      }

      if (portal === 'chatgpt') {
        const promptArea = page.locator('#prompt-textarea').first();
        return await promptArea.isVisible();
      }

      if (portal === 'claude') {
        if (!url.includes('/chats') && !url.includes('/chat')) {
          return false;
        }
        const promptArea = page.locator('div[contenteditable="true"].ProseMirror, textarea[placeholder*="Claude"]').first();
        return await promptArea.isVisible();
      }

      if (portal === 'deepseek') {
        const promptArea = page.locator('#chat-input, textarea[placeholder*="DeepSeek"]').first();
        return await promptArea.isVisible();
      }

      return false;
    } catch {
      return false;
    }
  }

  /**
   * Verifies portal authentication sequentially in a temporary page.
   */
  async checkAllPortalsStatus(): Promise<Record<string, boolean>> {
    if (this.loginInProgress) {
      throw new Error('Login manual em andamento. Aguarde concluir antes de verificar status.');
    }

    const wasInitialized = this.context !== null;
    let page: Page | null = null;
    try {
      if (!this.context) {
        page = await this.launchContext(true);
      } else {
        page = await this.context.newPage();
      }

      const results: Record<string, boolean> = {
        google: false,
        gemini: false,
        chatgpt: false,
        claude: false,
        deepseek: false
      };

      // 1. Check Google Flow on the active page or navigate to it
      const currentUrl = page.url();
      if (!currentUrl.includes('labs.google') && !currentUrl.includes('google.com') && !currentUrl.includes('flow.google')) {
        await page.goto(this.config.flowUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
      }
      results.google = await this.checkAuthenticated(page);

      // 2. Helper to check another portal on the same temporary page.
      const checkPortal = async (portal: 'gemini' | 'chatgpt' | 'claude' | 'deepseek', url: string) => {
        try {
          await page!.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
          return await this.checkPortalAuthenticated(page!, portal);
        } catch (err) {
          logger.error(`[FlowSession] Erro ao verificar portal ${portal}:`, err);
          return false;
        }
      };

      results.gemini = await checkPortal('gemini', 'https://gemini.google.com');
      results.chatgpt = await checkPortal('chatgpt', 'https://chatgpt.com');
      results.claude = await checkPortal('claude', 'https://claude.ai');
      results.deepseek = await checkPortal('deepseek', 'https://chat.deepseek.com');

      return results;
    } catch (err) {
      logger.error('[FlowSession] Erro geral ao verificar status dos portais:', err);
      return {
        google: false,
        gemini: false,
        chatgpt: false,
        claude: false,
        deepseek: false
      };
    } finally {
      if (!wasInitialized) {
        await this.close().catch(() => {});
      } else if (page && !page.isClosed()) {
        await page.close().catch(() => {});
      }
    }
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
