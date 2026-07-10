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
      '--disable-dev-shm-usage',
      '--disable-web-security',
      '--disable-blink-features=AutomationControlled'
    ],
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
  });
  const page = context.pages()[0] || await context.newPage();
  try {
    console.log('[INSPECT] Navegando para flow.google...');
    await page.goto('https://flow.google', { waitUntil: 'networkidle', timeout: 60000 });
    await page.waitForTimeout(3000);
    // Enter project
    const newProjectBtn = page.locator('button:has-text("Novo projeto"), button:has-text("New project"), button:has-text("add_2")');
    if (await newProjectBtn.count() > 0) {
      await newProjectBtn.first().click();
      await page.waitForTimeout(6000);
      // Locate the model selector button (it has text like Nano Banana or Veo)
      console.log('[INSPECT] Procurando botão seletor de modelos...');
      const modelBtn = page.locator('button:has-text("Banana"), button:has-text("Veo"), button:has-text("Nano")');
      if (await modelBtn.count() > 0) {
        console.log('[INSPECT] Botão seletor de modelos encontrado. Clicando...');
        await modelBtn.first().click();
        await page.waitForTimeout(2000);
        // Capture popup screenshot
        const screenshotPath = path.resolve('storage/flow-models-popup.png');
        await page.screenshot({ path: screenshotPath });
        console.log(`[INSPECT] Screenshot do menu salva em: ${screenshotPath}`);
        // Print visible text in popover/dialog/menu
        console.log('[INSPECT] Buscando opções no menu de modelos...');
        const popoverText = await page.evaluate(() => {
          // Find radix popovers or dialogs
          const popovers = Array.from(document.querySelectorAll('[role="dialog"], [role="menu"], [role="listbox"], .radix-themes, div[data-radix-popper-content-wrapper]'));
          return popovers.map(el => el.textContent || el.innerHTML);
        });
        console.log('--- OPÇÕES DO POPOVER ---');
        console.log(popoverText);
        console.log('-------------------------');
        // Dump menu items
        const menuItems = await page.evaluate(() => {
          return Array.from(document.querySelectorAll('[role="menuitem"], [role="option"], button, a')).map(el => {
            return {
              tag: el.tagName.toLowerCase(),
              text: el.textContent || '',
              role: el.getAttribute('role') || '',
              ariaLabel: el.getAttribute('aria-label') || '',
              className: el.className || ''
            };
          });
        });
        console.log('Mapeamento de botões/opções após abrir menu:');
        console.log(JSON.stringify(menuItems.filter(item => item.text.trim().length > 0).slice(0, 30), null, 2));
      } else {
        console.error('[INSPECT] Botão seletor de modelos não encontrado.');
      }
    }
  } catch (err) {
    console.error('[INSPECT] Erro:', err);
  } finally {
    await context.close();
    console.log('[INSPECT] Navegador fechado.');
  }
}
main().catch(console.error);
