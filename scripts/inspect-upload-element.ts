import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  console.log('[INSPECT] Inicializando navegador com perfil persistente...');
  const profilePath = path.resolve('storage/browser-profile/');
  const savedUrlPath = path.resolve('storage/flow_project_url.txt');
  
  let targetUrl = 'https://flow.google';
  if (fs.existsSync(savedUrlPath)) {
    targetUrl = fs.readFileSync(savedUrlPath, 'utf-8').trim();
  }
  console.log(`[INSPECT] URL de destino: ${targetUrl}`);

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
    console.log('[INSPECT] Navegando para o workspace...');
    await page.goto(targetUrl, { waitUntil: 'load', timeout: 60000 });
    await page.waitForLoadState('domcontentloaded');
    console.log('[INSPECT] Aguardando 10 segundos para estabilizar...');
    await page.waitForTimeout(10000);

    // Save a screenshot
    const screenshotPath = path.resolve('storage/flow-workspace-debug.png');
    await page.screenshot({ path: screenshotPath });
    console.log(`[INSPECT] Screenshot salvo em: ${screenshotPath}`);

    // Scan for all inputs, specifically file inputs
    const inputsInfo = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('input'));
      return inputs.map((input, idx) => ({
        index: idx,
        type: input.type || '',
        name: input.name || '',
        id: input.id || '',
        placeholder: input.placeholder || '',
        className: input.className || '',
        accept: input.getAttribute('accept') || '',
        outerHTML: input.outerHTML
      }));
    });

    console.log('[INSPECT] Inputs encontrados:');
    console.log(JSON.stringify(inputsInfo, null, 2));

    // Scan for buttons with upload-like names or icons
    const buttonsInfo = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('button, [role="button"]'));
      return btns.map((btn, idx) => {
        const text = btn.textContent?.trim() || '';
        const ariaLabel = btn.getAttribute('aria-label') || '';
        const id = btn.id || '';
        const innerHTML = btn.innerHTML;
        if (
          text.toLowerCase().includes('upload') ||
          text.toLowerCase().includes('imagem') ||
          text.toLowerCase().includes('image') ||
          text.toLowerCase().includes('referencia') ||
          text.toLowerCase().includes('referência') ||
          text.toLowerCase().includes('add') ||
          text.toLowerCase().includes('upload_file') ||
          text.toLowerCase().includes('attach') ||
          ariaLabel.toLowerCase().includes('upload') ||
          ariaLabel.toLowerCase().includes('image') ||
          ariaLabel.toLowerCase().includes('referencia') ||
          ariaLabel.toLowerCase().includes('referência') ||
          ariaLabel.toLowerCase().includes('add') ||
          innerHTML.includes('upload_file') ||
          innerHTML.includes('attach')
        ) {
          return {
            index: idx,
            text,
            ariaLabel,
            id,
            className: btn.className || '',
            outerHTML: btn.outerHTML
          };
        }
        return null;
      }).filter(Boolean);
    });

    console.log('[INSPECT] Botões de upload/imagem/referência ou similares encontrados:');
    console.log(JSON.stringify(buttonsInfo, null, 2));

  } catch (err) {
    console.error('[INSPECT] Erro na inspeção:', err);
  } finally {
    await context.close();
    console.log('[INSPECT] Navegador fechado.');
  }
}

main().catch(console.error);
