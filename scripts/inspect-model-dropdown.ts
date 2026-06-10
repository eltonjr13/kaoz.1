import { chromium } from 'playwright';
import * as path from 'path';

async function main() {
  console.log('[INSPECT] Inicializando navegador...');
  const profilePath = path.resolve('storage/browser-profile/');
  
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: true,
    viewport: { width: 1280, height: 720 },
    ignoreDefaultArgs: ['--enable-automation'],
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-blink-features=AutomationControlled'
    ],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });

  const page = context.pages()[0] || await context.newPage();

  try {
    console.log('[INSPECT] Navegando para flow.google...');
    await page.goto('https://flow.google', { waitUntil: 'load', timeout: 60000 });
    
    // Wait for projects list
    console.log('[INSPECT] Aguardando lista de projetos...');
    await page.locator('button:has-text("Editar projeto")').first().waitFor({ state: 'visible', timeout: 20000 });

    const projectCard = page.locator('a[href*="/project/"]').first();
    await projectCard.click();

    console.log('[INSPECT] Aguardando o workspace carregar...');
    const workspaceTextbox = page.locator('[role="textbox"], div[contenteditable="true"]').first();
    await workspaceTextbox.waitFor({ state: 'visible', timeout: 20000 });

    // Open model settings popover
    console.log('[INSPECT] Abrindo popover de modelos...');
    const modelBtn = page.locator('button').filter({ hasText: /Veo|Banana/ }).first();
    await modelBtn.click();
    await page.waitForTimeout(1000);

    // Locate the model name selector dropdown (e.g. containing Nano Banana)
    console.log('[INSPECT] Procurando dropdown do modelo específico...');
    const dropdownSelect = page.locator('[role="dialog"], div[data-radix-popper-content-wrapper]').locator('button').filter({ hasText: /Banana|Veo/ }).first();
    await dropdownSelect.waitFor({ state: 'visible', timeout: 5000 });
    console.log('[INSPECT] Clicando no dropdown do modelo...');
    await dropdownSelect.click();
    await page.waitForTimeout(1000);

    const dropdownScreenshotPath = path.resolve('storage/flow-model-dropdown.png');
    await page.screenshot({ path: dropdownScreenshotPath });
    console.log(`[INSPECT] Screenshot do dropdown de modelos salva em: ${dropdownScreenshotPath}`);

    // Dump all items visible in the model dropdown
    const options = await page.evaluate(() => {
      const menus = Array.from(document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"], div[data-radix-popper-content-wrapper], .radix-themes'));
      return menus.map(el => el.textContent?.trim() || '');
    });

    console.log('--- OPÇÕES DO DROPDOWN DE MODELOS ---');
    console.log(options);
    console.log('------------------------------------');

    // Dump individual menu items
    const menuItems = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], button, a')).map(el => {
        return {
          tag: el.tagName.toLowerCase(),
          text: el.textContent?.trim() || '',
          role: el.getAttribute('role') || '',
          ariaLabel: el.getAttribute('aria-label') || ''
        };
      });
    });

    console.log('Itens de menu mapeados:');
    console.log(JSON.stringify(menuItems.filter(item => item.text.length > 0).slice(0, 30), null, 2));

  } catch (err) {
    console.error('[INSPECT] Erro durante a inspeção:', err);
  } finally {
    await context.close();
    console.log('[INSPECT] Navegador fechado.');
  }
}

main().catch(console.error);
