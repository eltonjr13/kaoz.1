import { chromium } from 'playwright';
import * as path from 'path';
import * as fs from 'fs';

async function main() {
  console.log('[INSPECT-DEEPSEEK] Starting chromium with persistent context...');
  const profilePath = path.resolve('storage/browser-profile/');
  
  const context = await chromium.launchPersistentContext(profilePath, {
    headless: true, // run headlessly
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
    console.log('[INSPECT-DEEPSEEK] Navigating to https://chat.deepseek.com ...');
    await page.goto('https://chat.deepseek.com', { waitUntil: 'domcontentloaded', timeout: 45000 });
    
    await page.waitForTimeout(5000);
    console.log('[INSPECT-DEEPSEEK] Current URL:', page.url());

    // Take initial screenshot
    const screenshotDir = path.resolve('storage');
    if (!fs.existsSync(screenshotDir)) {
      fs.mkdirSync(screenshotDir, { recursive: true });
    }
    const screenshot1 = path.join(screenshotDir, 'deepseek-initial.png');
    await page.screenshot({ path: screenshot1 });
    console.log('[INSPECT-DEEPSEEK] Initial screenshot saved to:', screenshot1);

    // Check if redirect to login happened
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/sign-up')) {
      console.warn('[INSPECT-DEEPSEEK] WARNING: Not logged in! Redirected to login page.');
      return;
    }

    // Inspect inputs and send buttons
    const interactiveElements = await page.evaluate(() => {
      const inputs = Array.from(document.querySelectorAll('textarea, input, [contenteditable="true"], button, a, [role="button"]')).map(el => {
        const inputEl = el as HTMLElement & { type?: string; placeholder?: string };
        return {
          tag: el.tagName.toLowerCase(),
          id: el.id || '',
          placeholder: inputEl.placeholder || el.getAttribute('placeholder') || '',
          text: (el.textContent || '').trim().slice(0, 50),
          role: el.getAttribute('role') || '',
          className: el.className || '',
          ariaLabel: el.getAttribute('aria-label') || ''
        };
      });
      return inputs;
    });

    console.log('[INSPECT-DEEPSEEK] First 20 interactive elements found:');
    console.log(JSON.stringify(interactiveElements.slice(0, 20), null, 2));

    // Try finding the input field using our current selectors
    const selectors = ['textarea', '#chat-input', 'div[contenteditable="true"]'];
    let inputFound = false;
    for (const selector of selectors) {
      const loc = page.locator(selector);
      const count = await loc.count();
      console.log(`[INSPECT-DEEPSEEK] Locator '${selector}' count:`, count);
      if (count > 0) {
        inputFound = true;
        for (let i = 0; i < count; i++) {
          const visible = await loc.nth(i).isVisible();
          const placeholder = await loc.nth(i).getAttribute('placeholder');
          console.log(`  - nth(${i}) visible: ${visible}, placeholder: ${placeholder}`);
        }
      }
    }

    if (!inputFound) {
      console.log('[INSPECT-DEEPSEEK] Could not find any input field using selectors.');
    } else {
      console.log('[INSPECT-DEEPSEEK] Attempting to send a test message...');
      // Type message
      const input = page.locator('textarea, #chat-input').first();
      await input.focus();
      await input.fill('Hi, reply with exactly the word "CHICKEN" and nothing else.');
      
      // Look for send button
      const sendBtnSelectors = [
        'div[role="button"]',
        'button[type="submit"]',
        '.send-btn',
        'div[aria-label="Send"]',
        'button:has(svg)'
      ];
      
      console.log('[INSPECT-DEEPSEEK] Looking for send buttons...');
      for (const selector of sendBtnSelectors) {
        const loc = page.locator(selector);
        const count = await loc.count();
        console.log(`  - Send Locator '${selector}' count: ${count}`);
        if (count > 0) {
          const visible = await loc.first().isVisible();
          console.log(`    - First visible: ${visible}`);
        }
      }

      const sendBtn = page.locator('div[role="button"], button[type="submit"], .send-btn').first();
      console.log('[INSPECT-DEEPSEEK] Clicking send button...');
      await sendBtn.click();
      
      console.log('[INSPECT-DEEPSEEK] Message sent. Waiting 10 seconds...');
      await page.waitForTimeout(10000);

      const screenshot2 = path.join(screenshotDir, 'deepseek-after-send.png');
      await page.screenshot({ path: screenshot2 });
      console.log('[INSPECT-DEEPSEEK] After-send screenshot saved to:', screenshot2);

      // Check message bubbles
      const bubbleSelectors = ['.ds-markdown', '.assistant-msg', '.chat-message', '.ds-icon-stop', '.stop-button'];
      for (const sel of bubbleSelectors) {
        const loc = page.locator(sel);
        console.log(`[INSPECT-DEEPSEEK] Selector '${sel}' count:`, await loc.count());
        if (await loc.count() > 0) {
          console.log(`  - Last element innerText:`, await loc.last().innerText());
        }
      }

      // Check all elements with class containing 'markdown' or similar
      const possibleBubbles = await page.evaluate(() => {
        return Array.from(document.querySelectorAll('*'))
          .filter(el => {
            const className = el.className || '';
            if (typeof className !== 'string') return false;
            return className.includes('markdown') || className.includes('message') || className.includes('chat') || className.includes('bubble');
          })
          .map(el => ({
            tag: el.tagName.toLowerCase(),
            className: el.className,
            text: (el.textContent || '').trim().slice(0, 100)
          }));
      });
      console.log('[INSPECT-DEEPSEEK] Possible bubbles found in DOM:', possibleBubbles.slice(0, 15));
    }

  } catch (err) {
    console.error('[INSPECT-DEEPSEEK] Error:', err);
  } finally {
    await context.close();
    console.log('[INSPECT-DEEPSEEK] Context closed.');
  }
}

main();
