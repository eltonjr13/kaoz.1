import { chromium } from 'playwright';
import * as path from 'path';
async function main() {
  console.log('[INSPECT] Inicializando navegador com perfil persistente...');
  const profilePath = path.resolve('storage/browser-profile/');
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: true, // We run headlessly for inspection
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
    console.log('[INSPECT] URL Atual:', page.url());
    console.log('[INSPECT] Aguardando 5 segundos para renderização do SPA...');
    await page.waitForTimeout(5000);
    // Save screenshot
    const screenshotPath = path.resolve('storage/flow-screenshot.png');
    console.log(`[INSPECT] Salvando screenshot em: ${screenshotPath}`);
    await page.screenshot({ path: screenshotPath });
    // Print text on the page
    console.log('[INSPECT] Obtendo texto visível da página...');
    const bodyText = await page.innerText('body');
    console.log('--- TEXTO DO BODY ---');
    console.log(bodyText.slice(0, 1000));
    console.log('---------------------');
    // List all input fields, buttons, and textareas
    console.log('[INSPECT] Mapeando elementos interativos...');
    const interactiveElements = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('textarea, input, [contenteditable="true"], button, a, [role="tab"]')).map(el => {
        const inputEl = el as HTMLElement & { type?: string; placeholder?: string };
        return {
          tag: el.tagName.toLowerCase(),
          type: inputEl.type || '',
          placeholder: inputEl.placeholder || el.getAttribute('placeholder') || '',
          text: inputEl.innerText || el.textContent || '',
          role: el.getAttribute('role') || '',
          ariaLabel: el.getAttribute('aria-label') || '',
          className: el.className || ''
        };
      });
      return inputs;
    });
    console.log(`[INSPECT] Encontrados ${interactiveElements.length} elementos interativos. Exibindo os primeiros 30:`);
    console.log(JSON.stringify(interactiveElements.slice(0, 30), null, 2));
  } catch (err) {
    console.error('[INSPECT] Ocorreu um erro durante a inspeção:', err);
  } finally {
    await context.close();
    console.log('[INSPECT] Navegador fechado.');
  }
}
main().catch(console.error);
