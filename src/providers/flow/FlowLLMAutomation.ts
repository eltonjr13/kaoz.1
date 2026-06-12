import { Page } from 'playwright';
import { FlowConfig } from './FlowTypes';
import { FlowSession } from './FlowSession';
import { logger, findSmartElement, ElementQuery, pollCondition } from './FlowUtils';

export class FlowLLMAutomation {
  constructor(private session: FlowSession, private config: FlowConfig) {}

  /**
   * Refines/optimizes a prompt using the selected LLM browser portal.
   * If the portal is offline, not logged in, or blocked, uses a smart local fallback prompt engineer.
   */
  async optimizePrompt(
    model: 'deepseek' | 'claude' | 'chatgpt' | 'gemini',
    rawPrompt: string,
    type: 'image' | 'video'
  ): Promise<string> {
    const promptTemplate = `Melhore o seguinte prompt de geração de ${
      type === 'video' ? 'vídeo' : 'imagem'
    } para torná-lo profissional, ultra-detalhado e de alto impacto visual. Retorne apenas o prompt melhorado em inglês, sem comentários adicionais, sem aspas e sem explicações: '${rawPrompt}'`;

    logger.info(`[Agente MrChicken] Iniciando otimização com modelo: ${model} para ${type}.`);

    try {
      const page = await this.session.getPage();
      
      switch (model) {
        case 'gemini':
          return await this.automateGemini(page, promptTemplate);
        case 'chatgpt':
          return await this.automateChatGPT(page, promptTemplate);
        case 'deepseek':
          return await this.automateDeepSeek(page, promptTemplate);
        case 'claude':
          return await this.automateClaude(page, promptTemplate);
        default:
          throw new Error(`Modelo ${model} não suportado.`);
      }
    } catch (err) {
      logger.warn(`[Agente MrChicken] Automação do ${model} indisponível ou bloqueada. Ativando Engenharia de Prompt local...`, err);
      return this.localPromptOptimizer(rawPrompt, type);
    }
  }

  /**
   * Gemini Web Automation
   */
  private async automateGemini(page: Page, prompt: string): Promise<string> {
    const url = 'https://gemini.google.com';
    logger.info(`[Agente MrChicken] Navegando para Gemini: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);

    // Verify if logged in
    const currentUrl = page.url();
    if (currentUrl.includes('accounts.google.com') || currentUrl.includes('signin')) {
      throw new Error('Sessão expirada no Gemini.');
    }

    // Locate chat input box
    const queries: ElementQuery[] = [
      { selector: 'div[role="textbox"]' },
      { selector: 'div[contenteditable="true"]' },
      { selector: '[contenteditable="true"]' },
      { placeholder: 'Digite aqui' },
      { placeholder: 'Enter a prompt' }
    ];

    logger.info('[Agente MrChicken] Inserindo prompt no Gemini...');
    const input = await findSmartElement(page, queries, 10000);
    await input.focus();
    await input.fill('');
    await input.fill(prompt);

    // Locate send button
    const sendBtnQueries: ElementQuery[] = [
      { selector: 'button[aria-label*="Enviar"]' },
      { selector: 'button[aria-label*="Send"]' },
      { selector: 'button.send-button' },
      { selector: 'button[type="submit"]' }
    ];

    logger.info('[Agente MrChicken] Enviando solicitação...');
    const sendBtn = await findSmartElement(page, sendBtnQueries, 5000);
    await sendBtn.click();

    // Wait for the response bubble to complete loading
    logger.info('[Agente MrChicken] Aguardando resposta do Gemini...');
    await page.waitForTimeout(6000);

    // Get the assistant response bubbles (Gemini usually uses class message-content or similar)
    const bubbles = page.locator('.message-content, .response-container, div[role="log"] div.assistant');
    await pollCondition(
      page,
      async () => {
        const count = await bubbles.count();
        if (count === 0) return false;
        const lastText = await bubbles.last().innerText();
        return lastText.trim().length > 15 && !lastText.includes('Digitando');
      },
      'Timeout aguardando resposta do Gemini.',
      30000,
      1500
    );

    const result = await bubbles.last().innerText();
    return this.cleanLLMResponse(result);
  }

  /**
   * ChatGPT Web Automation
   */
  private async automateChatGPT(page: Page, prompt: string): Promise<string> {
    const url = 'https://chatgpt.com';
    logger.info(`[Agente MrChicken] Navegando para ChatGPT: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);

    // Verify if logged in
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/auth') || currentUrl.includes('/signup')) {
      throw new Error('Sessão expirada no ChatGPT.');
    }

    const queries: ElementQuery[] = [
      { selector: '#prompt-textarea' },
      { selector: 'textarea' },
      { selector: 'div[contenteditable="true"]' }
    ];

    logger.info('[Agente MrChicken] Inserindo prompt no ChatGPT...');
    const input = await findSmartElement(page, queries, 10000);
    await input.focus();
    await input.fill('');
    await input.fill(prompt);

    const sendBtnQueries: ElementQuery[] = [
      { selector: 'button[data-testid="send-button"]' },
      { selector: 'button[aria-label*="Send"]' },
      { selector: 'button[type="submit"]' }
    ];

    logger.info('[Agente MrChicken] Enviando solicitação...');
    const sendBtn = await findSmartElement(page, sendBtnQueries, 5000);
    await sendBtn.click();

    logger.info('[Agente MrChicken] Aguardando resposta do ChatGPT...');
    await page.waitForTimeout(5000);

    // Locate the ChatGPT response blocks
    const bubbles = page.locator('div[data-message-author-role="assistant"], .markdown');
    await pollCondition(
      page,
      async () => {
        const count = await bubbles.count();
        if (count === 0) return false;
        // Verify that the stop generation button or typing cursor is gone
        const stopBtn = page.locator('button[aria-label*="Stop"], button[data-testid*="stop"]');
        return (await stopBtn.count() === 0) || !(await stopBtn.first().isVisible());
      },
      'Timeout aguardando resposta do ChatGPT.',
      30000,
      2000
    );

    const result = await bubbles.last().innerText();
    return this.cleanLLMResponse(result);
  }

  /**
   * DeepSeek Web Automation
   */
  private async automateDeepSeek(page: Page, prompt: string): Promise<string> {
    const url = 'https://chat.deepseek.com';
    logger.info(`[Agente MrChicken] Navegando para DeepSeek: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);

    // Verify if logged in
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/sign-up')) {
      throw new Error('Sessão expirada no DeepSeek.');
    }

    const queries: ElementQuery[] = [
      { selector: 'textarea' },
      { selector: '#chat-input' },
      { selector: 'div[contenteditable="true"]' }
    ];

    logger.info('[Agente MrChicken] Inserindo prompt no DeepSeek...');
    const input = await findSmartElement(page, queries, 10000);
    await input.focus();
    await input.fill('');
    await input.fill(prompt);

    const sendBtnQueries: ElementQuery[] = [
      { selector: 'div[role="button"]' },
      { selector: 'button[type="submit"]' },
      { selector: '.send-btn' }
    ];

    logger.info('[Agente MrChicken] Enviando solicitação...');
    const sendBtn = await findSmartElement(page, sendBtnQueries, 5000);
    await sendBtn.click();

    logger.info('[Agente MrChicken] Aguardando resposta do DeepSeek...');
    await page.waitForTimeout(5000);

    const bubbles = page.locator('.ds-markdown, .assistant-msg, .chat-message');
    await pollCondition(
      page,
      async () => {
        const count = await bubbles.count();
        if (count === 0) return false;
        const isGenerating = await page.locator('.ds-icon-stop, .stop-button').isVisible().catch(() => false);
        return !isGenerating;
      },
      'Timeout aguardando resposta do DeepSeek.',
      35000,
      2000
    );

    const result = await bubbles.last().innerText();
    return this.cleanLLMResponse(result);
  }

  /**
   * Claude Web Automation
   */
  private async automateClaude(page: Page, prompt: string): Promise<string> {
    const url = 'https://claude.ai';
    logger.info(`[Agente MrChicken] Navegando para Claude: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);

    // Verify if logged in
    const currentUrl = page.url();
    if (currentUrl.includes('/login') || currentUrl.includes('/auth') || !currentUrl.includes('/chat')) {
      throw new Error('Sessão expirada no Claude.');
    }

    const queries: ElementQuery[] = [
      { selector: 'div[contenteditable="true"]' },
      { selector: '[contenteditable="true"]' },
      { selector: 'textarea' }
    ];

    logger.info('[Agente MrChicken] Inserindo prompt no Claude...');
    const input = await findSmartElement(page, queries, 10000);
    await input.focus();
    await input.fill('');
    await input.fill(prompt);

    const sendBtnQueries: ElementQuery[] = [
      { selector: 'button[aria-label*="Send"]' },
      { selector: 'button[type="submit"]' },
      { selector: 'button:has(svg)' }
    ];

    logger.info('[Agente MrChicken] Enviando solicitação...');
    const sendBtn = await findSmartElement(page, sendBtnQueries, 5000);
    await sendBtn.click();

    logger.info('[Agente MrChicken] Aguardando resposta do Claude...');
    await page.waitForTimeout(5000);

    const bubbles = page.locator('.font-claude-message, .assistant, article');
    await pollCondition(
      page,
      async () => {
        const count = await bubbles.count();
        if (count === 0) return false;
        const isTyping = await page.locator('.typing-indicator, .stop-icon').isVisible().catch(() => false);
        return !isTyping;
      },
      'Timeout aguardando resposta do Claude.',
      35000,
      2000
    );

    const result = await bubbles.last().innerText();
    return this.cleanLLMResponse(result);
  }

  /**
   * Heuristic/Rule-based prompt optimizer when LLM portals are offline.
   */
  private localPromptOptimizer(rawPrompt: string, type: 'image' | 'video'): string {
    const cleaned = rawPrompt.replace(/[\'\"]/g, '').trim();
    
    // Core prompt enhancements
    const imageStyle = "cinematic photograph, detailed textures, soft studio volumetric lighting, depth of field, 8k resolution, shot on 85mm lens, photorealistic";
    const videoStyle = "4k cinematic video, smooth camera movement, highly detailed, slow motion, dynamic shadows, volumetric lighting, photorealistic, professional grade";

    const suffix = type === 'video' ? videoStyle : imageStyle;

    // Detect language and translate simple nouns to English fallbacks if possible
    let processedPrompt = cleaned;
    if (processedPrompt.toLowerCase().includes('pintinho')) {
      processedPrompt = processedPrompt.toLowerCase()
        .replace('pintinho amarelo', 'vibrant baby yellow chick')
        .replace('pintinho', 'vibrant baby chick')
        .replace('comendo milho', 'eating golden corn kernels on a rustic wooden floor');
    }

    return `${processedPrompt}, ${suffix}`;
  }

  /**
   * Strips LLM chat prefixes, markdown codeblocks or quotes.
   */
  private cleanLLMResponse(response: string): string {
    let cleaned = response.trim();
    // Remove markdown codeblock qualifiers
    cleaned = cleaned.replace(/```(markdown|text|json|plaintext)?/g, '').replace(/```/g, '').trim();
    // Remove surrounding quotes
    cleaned = cleaned.replace(/^["']|["']$/g, '').trim();
    return cleaned;
  }
}
