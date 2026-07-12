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
    // Locate "Novo projeto" or "New project" button
    console.log('[INSPECT] Procurando botão "Novo projeto" ou "New project"...');
    const newProjectBtn = page.locator('button:has-text("Novo projeto"), button:has-text("New project"), button:has-text("add_2")');
    if (await newProjectBtn.count() > 0) {
      console.log('[INSPECT] Botão encontrado. Clicando...');
      await newProjectBtn.first().click();
      console.log('[INSPECT] Aguardando 8 segundos para carregar o novo projeto...');
      await page.waitForTimeout(8000);
      console.log('[INSPECT] URL Atual do Projeto:', page.url());
      // Save screenshot
      const screenshotPath = path.resolve('storage/flow-project-screenshot.png');
      console.log(`[INSPECT] Salvando screenshot do projeto em: ${screenshotPath}`);
      await page.screenshot({ path: screenshotPath });
      // Print body text
      const bodyText = await page.innerText('body');
      console.log('--- TEXTO DO PROJETO ---');
      console.log(bodyText.slice(0, 1500));
      console.log('---------------------');
      // List interactive elements
      const elements = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('textarea, input, [contenteditable="true"], button, a, [role="tab"], [role="textbox"]')).map(el => {
          const inputEl = el as HTMLElement & { type?: string; placeholder?: string };
          return {
            tag: el.tagName.toLowerCase(),
            type: inputEl.type || '',
            placeholder: inputEl.placeholder || el.getAttribute('placeholder') || '',
            text: inputEl.innerText || el.textContent || '',
            role: el.getAttribute('role') || '',
            ariaLabel: el.getAttribute('aria-label') || '',
            id: el.id || '',
            className: el.className || ''
          };
        });
      });
      console.log(`[INSPECT] Encontrados ${elements.length} elementos no workspace.`);
      console.log('Exibindo os primeiros 30 elementos do workspace:');
      console.log(JSON.stringify(elements.slice(0, 30), null, 2));
    } else {
      console.error('[INSPECT] Erro: Botão "Novo projeto" não localizado na página inicial.');
    }
  } catch (err) {
    console.error('[INSPECT] Ocorreu um erro:', err);
  } finally {
    await context.close();
    console.log('[INSPECT] Navegador fechado.');
  }
}
main().catch(console.error);
