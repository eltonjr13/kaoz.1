import { Page } from 'playwright';
import { GoogleGenAI } from '@google/genai';
import { OpenAI } from 'openai';
import { FlowConfig } from './FlowTypes';
import { FlowSession } from './FlowSession';
import { logger, findSmartElement, ElementQuery, pollCondition } from './FlowUtils';
import { queryConfiguredAgentCli, runCerebrasApi } from '@/services/agent-llm/agent-llm.service';

type LLMModel = 'deepseek' | 'claude' | 'chatgpt' | 'gemini' | 'cerebras';
type QueryWebLLMOptions = {
  onTextChunk?: (chunk: string) => void;
};

export class FlowLLMAutomation {
  constructor(private session: FlowSession, private config: FlowConfig) {}

  private shouldSkipWebAutomation(model: LLMModel): boolean {
    if (model === 'gemini') {
      return false;
    }
    return process.env.FLOW_ALLOW_PROTECTED_LLM_WEB !== 'true';
  }

  private async hasVisibleLoginPrompt(page: Page): Promise<boolean> {
    return await page
      .getByText(/Log in|Sign in|Entrar|Fazer login|Login/i)
      .first()
      .isVisible({ timeout: 1500 })
      .catch(() => false);
  }

  private async hasCloudflareChallenge(page: Page): Promise<boolean> {
    const url = page.url().toLowerCase();
    if (url.includes('cloudflare') || url.includes('challenge') || url.includes('turnstile')) {
      return true;
    }

    const challengeTextVisible = await page
      .getByText(/Confirme que .+ humano|verify you are human|checking your browser|cloudflare|turnstile/i)
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);
    if (challengeTextVisible) {
      return true;
    }

    return await page
      .locator('iframe[src*="challenges.cloudflare.com"], iframe[src*="turnstile"], input[name="cf-turnstile-response"]')
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false);
  }

  private async assertNoCloudflareChallenge(page: Page, model: LLMModel): Promise<void> {
    if (await this.hasCloudflareChallenge(page)) {
      throw new Error(`Portal ${model} bloqueado por Cloudflare/Turnstile. Use API oficial ou fallback local.`);
    }
  }

  private async optimizeWithGeminiApi(prompt: string): Promise<string | null> {
    // Gemini API desativada a pedido do usuario para forçar o uso exclusivo da CLI configurada.
    return null;
  }

  private async optimizeWithOpenAIApi(prompt: string): Promise<string | null> {
    if (!process.env.OPENAI_API_KEY) {
      return null;
    }

    const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7
    });
    return this.cleanLLMResponse(response.choices[0]?.message?.content || '');
  }

  private async optimizeWithDeepSeekApi(prompt: string): Promise<string | null> {
    if (!process.env.DEEPSEEK_API_KEY) {
      return null;
    }

    const deepseek = new OpenAI({
      apiKey: process.env.DEEPSEEK_API_KEY,
      baseURL: process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com'
    });
    const response = await deepseek.chat.completions.create({
      model: process.env.DEEPSEEK_MODEL || 'deepseek-chat',
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.7
    });
    return this.cleanLLMResponse(response.choices[0]?.message?.content || '');
  }

  private async optimizeWithClaudeApi(prompt: string): Promise<string | null> {
    if (!process.env.ANTHROPIC_API_KEY) {
      return null;
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: process.env.ANTHROPIC_MODEL || 'claude-3-5-haiku-latest',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }]
      })
    });

    if (!response.ok) {
      throw new Error(`Anthropic API retornou ${response.status}: ${await response.text()}`);
    }

    const data = await response.json() as {
      content?: Array<{ type?: string; text?: string }>;
    };
    const text = data.content?.find(part => part.type === 'text')?.text || '';
    return this.cleanLLMResponse(text);
  }

  private async optimizeWithCerebrasApi(
    prompt: string,
    options: QueryWebLLMOptions = {},
    referenceImagePath?: string
  ): Promise<string | null> {
    if (!process.env.CEREBRAS_API_KEY) {
      return null;
    }

    const cerebras = new OpenAI({
      apiKey: process.env.CEREBRAS_API_KEY,
      baseURL: process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1'
    });

    const model = process.env.CEREBRAS_MODEL || 'gemma-4-31b';
    const shouldStream = Boolean(options.onTextChunk);

    const messages: any[] = [];
    if (referenceImagePath) {
      try {
        const fs = await import('node:fs');
        const fileBuffer = fs.readFileSync(referenceImagePath);
        const base64Image = fileBuffer.toString('base64');
        const mimeType = referenceImagePath.toLowerCase().endsWith('.png') ? 'image/png' : 'image/jpeg';
        messages.push({
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`
              }
            }
          ]
        });
      } catch (err) {
        logger.error('[Agente MrChicken] Falha ao ler imagem de referencia para Cerebras:', err);
        messages.push({ role: 'user', content: prompt });
      }
    } else {
      messages.push({ role: 'user', content: prompt });
    }

    const extraBody: Record<string, any> = {};
    if (model.includes('glm')) {
      extraBody.clear_thinking = true;
    }

    if (shouldStream) {
      const responseStream: any = await cerebras.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        stream: true,
        extra_body: Object.keys(extraBody).length > 0 ? extraBody : undefined
      } as any);

      let fullText = '';
      for await (const chunk of responseStream) {
        const text = chunk.choices[0]?.delta?.content || '';
        if (text) {
          fullText += text;
          options.onTextChunk?.(text);
        }
      }
      return this.cleanLLMResponse(fullText);
    } else {
      const response = await cerebras.chat.completions.create({
        model,
        messages,
        temperature: 0.7,
        extra_body: Object.keys(extraBody).length > 0 ? extraBody : undefined
      } as any);
      return this.cleanLLMResponse(response.choices[0]?.message?.content || '');
    }
  }

  private async optimizeWithApi(
    model: LLMModel,
    prompt: string,
    options?: QueryWebLLMOptions,
    referenceImagePath?: string
  ): Promise<string | null> {
    try {
      switch (model) {
        case 'gemini':
          return await this.optimizeWithGeminiApi(prompt);
        case 'chatgpt':
          return await this.optimizeWithOpenAIApi(prompt);
        case 'deepseek':
          return await this.optimizeWithDeepSeekApi(prompt);
        case 'claude':
          return await this.optimizeWithClaudeApi(prompt);
        case 'cerebras':
          return this.cleanLLMResponse(await runCerebrasApi(prompt, {
            referenceImagePath,
            onTextChunk: options?.onTextChunk,
          }));
      }
    } catch (err) {
      logger.warn(`[Agente MrChicken] API do modelo ${model} indisponivel.`, err);
      return null;
    }
  }

  private async queryConfiguredCli(
    prompt: string,
    referenceImagePath?: string,
    options: QueryWebLLMOptions = {}
  ): Promise<string | null> {
    try {
      const result = await queryConfiguredAgentCli(prompt, {
        referenceImagePath,
        onTextChunk: options.onTextChunk,
      });
      return result ? this.cleanLLMResponse(result) : null;
    } catch (err) {
      logger.warn('[Agente MrChicken] CLI configurada indisponivel. Usando fallback existente.', err);
      return null;
    }
  }

  /**
   * Refines/optimizes a prompt using the selected LLM browser portal.
   * If the portal is offline, not logged in, or blocked, uses a smart local fallback prompt engineer.
   */
  async optimizePrompt(
    model: LLMModel,
    rawPrompt: string,
    type: 'image' | 'video'
  ): Promise<string> {

    const promptTemplate = `Melhore o seguinte prompt de geração de ${
      type === 'video' ? 'vídeo' : 'imagem'
    } para torná-lo profissional, ultra-detalhado e de alto impacto visual. Retorne apenas o prompt melhorado em inglês, sem comentários adicionais, sem aspas e sem explicações: '${rawPrompt}'`;

    logger.info(`[Agente MrChicken] Iniciando otimização com modelo: ${model} para ${type}.`);

    const apiResult = await this.optimizeWithApi(model, promptTemplate);
    if (apiResult) {
      logger.info(`[Agente MrChicken] Prompt otimizado via API do modelo: ${model}.`);
      return apiResult;
    }

    const cliResult = await this.queryConfiguredCli(promptTemplate);
    if (cliResult) {
      logger.info('[Agente MrChicken] Prompt otimizado via CLI configurada.');
      return cliResult;
    }
    if (this.shouldSkipWebAutomation(model)) {
      logger.warn(
        `[Agente MrChicken] Automacao web do ${model} desativada para evitar loop de Cloudflare/Turnstile. Usando fallback local.`
      );
      return this.localPromptOptimizer(rawPrompt, type);
    }

    try {
      const page = await this.session.getAutomationPage();
      
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
   * Executa uma consulta direta ao LLM para o chat, priorizando a CLI configurada antes do navegador.
   */
  async queryWebLLM(
    model: LLMModel,
    prompt: string,
    referenceImagePath?: string,
    options: QueryWebLLMOptions = {}
  ): Promise<string> {
    // 1. Tentar API direta se não houver imagem OR se for o Cerebras (que não possui automação web)
    if (!referenceImagePath || model === 'cerebras') {
      const apiResult = await this.optimizeWithApi(model, prompt, options, referenceImagePath);
      if (apiResult) {
        logger.info(`[Agente MrChicken] Resposta obtida via API rápida do modelo: ${model}.`);
        if (model !== 'cerebras' && options.onTextChunk) {
          options.onTextChunk(apiResult);
        }
        return apiResult;
      }
    }

    // 2. Fallback para CLI configurada
    const cliResult = await this.queryConfiguredCli(prompt, referenceImagePath, options);
    if (cliResult) {
      logger.info('[Agente MrChicken] Resposta obtida via CLI configurada.');
      return cliResult;
    }

    if (model === 'cerebras') {
      throw new Error("Cerebras API key não configurada ou erro na chamada direta da API.");
    }

    logger.info(`[Agente MrChicken] Iniciando Web Automation forcada com modelo: ${model}.`);

    if (this.shouldSkipWebAutomation(model)) {
      logger.warn(`[Agente MrChicken] Automacao web do ${model} esta restrita. Certifique-se de que FLOW_ALLOW_PROTECTED_LLM_WEB=true.`);
    }

    try {
      const page = await this.session.getAutomationPage();
      
      switch (model) {
        case 'gemini':
          return await this.automateGemini(page, prompt, referenceImagePath);
        case 'chatgpt':
          return await this.automateChatGPT(page, prompt, referenceImagePath);
        case 'deepseek':
          return await this.automateDeepSeek(page, prompt, referenceImagePath);
        case 'claude':
          return await this.automateClaude(page, prompt, referenceImagePath);
        default:
          throw new Error(`Modelo ${model} não suportado.`);
      }
    } catch (err) {
      logger.error(`[Agente MrChicken] Falha ao consultar ${model} via Playwright.`, err);
      throw err;
    }
  }


  /**
   * Gemini Web Automation
   */
  private async automateGemini(page: Page, prompt: string, referenceImagePath?: string): Promise<string> {
    const url = 'https://gemini.google.com';
    logger.info(`[Agente MrChicken] Navegando para Gemini: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);
    await this.assertNoCloudflareChallenge(page, 'gemini');

    if (referenceImagePath) {
      logger.info(`[Agente MrChicken] Enviando imagem de referência no Gemini: ${referenceImagePath}`);
      try {
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(referenceImagePath);
        await page.waitForTimeout(3000);
      } catch (err) {
        logger.error('Erro ao fazer upload de imagem no Gemini:', err);
      }
    }

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
    try {
      await input.focus();
      await input.fill('');
      await input.fill(prompt);
    } catch (err) {
      logger.warn('Falha ao usar fill no Gemini. Usando teclado virtual...', err);
      await input.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(prompt, { delay: 10 });
    }

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

    let lastText = '';
    let stableCount = 0;

    // Get the assistant response bubbles (Gemini usually uses class message-content or similar)
    const bubbles = page.locator('.message-content, .response-container, div[role="log"] div.assistant');
    await pollCondition(
      page,
      async () => {
        const count = await bubbles.count();
        if (count === 0) return false;

        const currentText = (await bubbles.last().innerText()).trim();

        // Se o texto for muito curto, ainda não começou a responder ou está vazio
        if (currentText.length < 15) {
          return false;
        }

        // Se ainda estiver com indicador de digitação
        if (currentText.includes('Digitando') || currentText.includes('Typing')) {
          return false;
        }

        // Verifica se há um botão de "Parar" / "Stop" ativo (indicativo de geração em andamento)
        const stopBtn = page.locator('button[aria-label*="Stop"], button[aria-label*="Parar"], button[aria-label*="Cancel"], button[aria-label*="Interromper"]');
        const isStopBtnVisible = await stopBtn.first().isVisible().catch(() => false);
        if (isStopBtnVisible) {
          stableCount = 0;
          return false;
        }

        // Se o texto estabilizou entre iterações
        if (currentText === lastText) {
          stableCount++;
        } else {
          stableCount = 0;
          lastText = currentText;
        }

        // Considera finalizado se o texto estiver estável por 2 iterações consecutivas (~3s)
        return stableCount >= 2;
      },
      'Timeout aguardando resposta do Gemini.',
      45000,
      1500
    );

    const result = await bubbles.last().innerText();
    return this.cleanLLMResponse(result);
  }

  /**
   * ChatGPT Web Automation
   */
  private async automateChatGPT(page: Page, prompt: string, referenceImagePath?: string): Promise<string> {
    const url = 'https://chatgpt.com';
    logger.info(`[Agente MrChicken] Navegando para ChatGPT: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);
    await this.assertNoCloudflareChallenge(page, 'chatgpt');

    if (referenceImagePath) {
      logger.info(`[Agente MrChicken] Enviando imagem de referência no ChatGPT: ${referenceImagePath}`);
      try {
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(referenceImagePath);
        await page.waitForTimeout(3000);
      } catch (err) {
        logger.error('Erro ao fazer upload de imagem no ChatGPT:', err);
      }
    }

    // Verify if logged in
    const currentUrl = page.url();
    if (
      currentUrl.includes('/login') ||
      currentUrl.includes('/auth') ||
      currentUrl.includes('/signup') ||
      await this.hasVisibleLoginPrompt(page)
    ) {
      throw new Error('Sessão expirada no ChatGPT.');
    }

    const queries: ElementQuery[] = [
      { selector: '#prompt-textarea' },
      { selector: 'textarea' },
      { selector: 'div[contenteditable="true"]' }
    ];

    logger.info('[Agente MrChicken] Inserindo prompt no ChatGPT...');
    const input = await findSmartElement(page, queries, 10000);
    try {
      await input.focus();
      await input.fill('');
      await input.fill(prompt);
    } catch (err) {
      logger.warn('Falha ao usar fill no ChatGPT. Usando teclado virtual...', err);
      await input.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(prompt, { delay: 10 });
    }

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
  private async automateDeepSeek(page: Page, prompt: string, referenceImagePath?: string): Promise<string> {
    const url = 'https://chat.deepseek.com';
    logger.info(`[Agente MrChicken] Navegando para DeepSeek: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);
    await this.assertNoCloudflareChallenge(page, 'deepseek');

    if (referenceImagePath) {
      logger.info(`[Agente MrChicken] Enviando imagem de referência no DeepSeek: ${referenceImagePath}`);
      try {
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(referenceImagePath);
        await page.waitForTimeout(3000);
      } catch (err) {
        logger.error('Erro ao fazer upload de imagem no DeepSeek:', err);
      }
    }

    // Verify if logged in
    const currentUrl = page.url();
    if (
      currentUrl.includes('/login') ||
      currentUrl.includes('/sign_in') ||
      currentUrl.includes('/sign-in') ||
      currentUrl.includes('/signup') ||
      currentUrl.includes('/sign-up') ||
      currentUrl.includes('signin')
    ) {
      throw new Error('Sessão expirada no DeepSeek.');
    }

    const queries: ElementQuery[] = [
      { selector: 'textarea' },
      { selector: '#chat-input' },
      { selector: 'div[contenteditable="true"]' }
    ];

    logger.info('[Agente MrChicken] Inserindo prompt no DeepSeek...');
    const input = await findSmartElement(page, queries, 10000);
    try {
      await input.focus();
      await input.fill('');
      await input.fill(prompt);
    } catch (err) {
      logger.warn('Falha ao usar fill no DeepSeek. Usando teclado virtual...', err);
      await input.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(prompt, { delay: 10 });
    }

    const sendBtnQueries: ElementQuery[] = [
      { selector: 'div[role="button"].ds-button--circle' },
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
  private async automateClaude(page: Page, prompt: string, referenceImagePath?: string): Promise<string> {
    const url = 'https://claude.ai';
    logger.info(`[Agente MrChicken] Navegando para Claude: ${url}`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(2000);
    await this.assertNoCloudflareChallenge(page, 'claude');

    if (referenceImagePath) {
      logger.info(`[Agente MrChicken] Enviando imagem de referência no Claude: ${referenceImagePath}`);
      try {
        const fileInput = page.locator('input[type="file"]').first();
        await fileInput.setInputFiles(referenceImagePath);
        await page.waitForTimeout(3000);
      } catch (err) {
        logger.error('Erro ao fazer upload de imagem no Claude:', err);
      }
    }

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
    try {
      await input.focus();
      await input.fill('');
      await input.fill(prompt);
    } catch (err) {
      logger.warn('Falha ao usar fill no Claude. Usando teclado virtual...', err);
      await input.click();
      await page.keyboard.press('Control+A');
      await page.keyboard.press('Backspace');
      await page.keyboard.type(prompt, { delay: 10 });
    }

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
