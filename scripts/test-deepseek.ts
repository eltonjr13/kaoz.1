import { chromium } from 'playwright';
import * as path from 'path';
// Replicate local prompt optimizer from FlowLLMAutomation
function localPromptOptimizer(rawPrompt: string, type: 'image' | 'video'): string {
  const cleaned = rawPrompt.replace(/[\'\"]/g, '').trim();
  const imageStyle = "cinematic photograph, detailed textures, soft studio volumetric lighting, depth of field, 8k resolution, shot on 85mm lens, photorealistic";
  const videoStyle = "4k cinematic video, smooth camera movement, highly detailed, slow motion, dynamic shadows, volumetric lighting, photorealistic, professional grade";
  const suffix = type === 'video' ? videoStyle : imageStyle;
  let processedPrompt = cleaned;
  if (processedPrompt.toLowerCase().includes('pintinho')) {
    processedPrompt = processedPrompt.toLowerCase()
      .replace('pintinho amarelo', 'vibrant baby yellow chick')
      .replace('pintinho', 'vibrant baby chick')
      .replace('comendo milho', 'eating golden corn kernels on a rustic wooden floor');
  }
  return `${processedPrompt}, ${suffix}`;
}
async function main() {
  console.log('[TEST-DEEPSEEK] Initializing browser context...');
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
  console.log('[TEST-DEEPSEEK] Replicating automateDeepSeek behavior...');
  const startTime = Date.now();
  const rawPrompt = 'um pintinho amarelo e fofinho comendo milho na fazenda';
  const type = 'image';
  try {
    const url = 'https://chat.deepseek.com';
    console.log(`[TEST-DEEPSEEK] Navigating to: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);
    const currentUrl = page.url();
    console.log(`[TEST-DEEPSEEK] Current page URL: ${currentUrl}`);
    // Verify if logged in using the updated checks
    if (
      currentUrl.includes('/login') ||
      currentUrl.includes('/sign_in') ||
      currentUrl.includes('/sign-in') ||
      currentUrl.includes('/signup') ||
      currentUrl.includes('/sign-up') ||
      currentUrl.includes('signin')
    ) {
      console.log('[TEST-DEEPSEEK] Auth verification: NOT logged in. Throwing Session Expired error...');
      throw new Error('Sessão expirada no DeepSeek.');
    }
    console.log('[TEST-DEEPSEEK] Auth verification: Logged in. (This shouldn\'t happen in unauthenticated test)');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    console.log(`[TEST-DEEPSEEK] Caught expected error: "${errMsg}"`);
    console.log('[TEST-DEEPSEEK] Activating local prompt engineer fallback...');
    const optimized = localPromptOptimizer(rawPrompt, type);
    console.log(`[TEST-DEEPSEEK] Input: "${rawPrompt}"`);
    console.log(`[TEST-DEEPSEEK] Output: "${optimized}"`);
  } finally {
    console.log(`[TEST-DEEPSEEK] Test finished in ${((Date.now() - startTime) / 1000).toFixed(2)} seconds.`);
    await context.close();
    console.log('[TEST-DEEPSEEK] Browser closed.');
  }
}
main().catch(console.error);
