import { chromium } from 'playwright';
import * as path from 'path';

async function main() {
  console.log('[INSPECT-DEEPSEEK-INPUT] Starting headful context...');
  const profilePath = path.resolve('storage/browser-profile/');
  
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: false, // run headfully
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
    console.log('[INSPECT-DEEPSEEK-INPUT] Navigating to https://chat.deepseek.com ...');
    await page.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(5000);

    console.log('[INSPECT-DEEPSEEK-INPUT] Current URL:', page.url());

    // Inspect the input area and any buttons nearby
    const inputAreaDetails = await page.evaluate(() => {
      // Find the textarea
      const textarea = document.querySelector('textarea');
      if (!textarea) return { error: 'Textarea not found' };

      // Find all buttons or interactive elements that are descendants of the textarea's parent/ancestor container
      let container: HTMLElement | null = textarea.parentElement;
      // Go up a few levels to find the main input container box
      for (let i = 0; i < 5; i++) {
        if (container && (container.className.includes('input') || container.className.includes('box') || container.className.includes('container'))) {
          break;
        }
        if (container) container = container.parentElement;
      }

      if (!container) container = document.body;

      const interactive = Array.from(container.querySelectorAll('button, div[role="button"], img, svg')).map(el => {
        const htmlEl = el as HTMLElement;
        return {
          tag: el.tagName.toLowerCase(),
          className: htmlEl.className || '',
          id: htmlEl.id || '',
          ariaLabel: htmlEl.getAttribute('aria-label') || '',
          role: htmlEl.getAttribute('role') || '',
          innerHtmlSnippet: htmlEl.innerHTML.slice(0, 150),
          outerText: (htmlEl.textContent || '').trim().slice(0, 50)
        };
      });

      return {
        containerTag: container.tagName.toLowerCase(),
        containerClass: container.className,
        interactiveElements: interactive
      };
    });

    console.log('[INSPECT-DEEPSEEK-INPUT] Input area details:');
    console.log(JSON.stringify(inputAreaDetails, null, 2));

  } catch (err) {
    console.error('[INSPECT-DEEPSEEK-INPUT] Error:', err);
  } finally {
    await context.close();
    console.log('[INSPECT-DEEPSEEK-INPUT] Context closed.');
  }
}

main();
