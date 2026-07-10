import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';
async function main() {
  console.log('[INSPECT] Inicializando navegador...');
  const profilePath = path.resolve('storage/browser-profile/');
  const savedUrlPath = path.resolve('storage/flow_project_url.txt');
  let targetUrl = 'https://flow.google';
  if (fs.existsSync(savedUrlPath)) {
    targetUrl = fs.readFileSync(savedUrlPath, 'utf-8').trim();
  }
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
    console.log('[INSPECT] Navegando para o workspace...');
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.waitForTimeout(8000);
    console.log('[INSPECT] Procurando botão add_2 no prompt...');
    // Locate the button with add_2 icon/text inside prompt bar
    const promptPlusBtn = page.locator('button:has-text("add_2"), button:has-text("Criar")').first();
    if (await promptPlusBtn.count() > 0 && await promptPlusBtn.isVisible()) {
      console.log('[INSPECT] Botão add_2 localizado. Clicando...');
      await promptPlusBtn.click();
      await page.waitForTimeout(3000);
      // Save screenshot
      const screenshotPath = path.resolve('storage/flow-prompt-plus-menu.png');
      await page.screenshot({ path: screenshotPath });
      console.log(`[INSPECT] Screenshot salvo em: ${screenshotPath}`);
      // List all text contents of overlays
      const overlayText = await page.evaluate(() => {
        const dialogs = Array.from(document.querySelectorAll('[role="menu"], [role="dialog"], [role="listbox"], div[data-radix-menu-content], [role="menuitem"]'));
        return dialogs.map(d => (d as HTMLElement).innerText || d.textContent || '');
      });
      console.log('[INSPECT] Overlays abertos:', overlayText);
    } else {
      console.error('[INSPECT] Botão add_2 no prompt não encontrado.');
    }
  } catch (err) {
    console.error('[INSPECT] Erro:', err);
  } finally {
    await context.close();
    console.log('[INSPECT] Navegador fechado.');
  }
}
main().catch(console.error);
