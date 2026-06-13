/* eslint-disable @typescript-eslint/no-explicit-any */
import { FlowConfig, ImageGenerationResult, VideoGenerationResult, FlowStatus, ImageGenerationOptions, VideoGenerationOptions } from './FlowTypes';
import { FlowSession } from './FlowSession';
import { FlowDownloader } from './FlowDownloader';
import { FlowImageGenerator } from './FlowImageGenerator';
import { FlowVideoGenerator } from './FlowVideoGenerator';
import { FlowLLMAutomation } from './FlowLLMAutomation';
import { logger } from './FlowUtils';
import { Page, Locator } from 'playwright';

export class FlowProvider {
  private config: FlowConfig;
  private session: FlowSession;
  private downloader: FlowDownloader;
  private imageGenerator: FlowImageGenerator;
  private videoGenerator: FlowVideoGenerator;
  private llmAutomation: FlowLLMAutomation;
  
  private activeTasksCount = 0;

  constructor(customConfig?: Partial<FlowConfig>) {
    // 1. Load configuration from environment variables with defaults
    this.config = {
      headless: process.env.FLOW_HEADLESS !== 'false', // Default true, override if 'false'
      timeout: process.env.FLOW_TIMEOUT ? parseInt(process.env.FLOW_TIMEOUT, 10) : 300000,
      downloadPath: process.env.FLOW_DOWNLOAD_PATH || 'storage/generated/',
      profilePath: process.env.FLOW_PROFILE_PATH || 'storage/browser-profile/',
      flowUrl: process.env.FLOW_URL || 'https://flow.google',
      imageUrl: process.env.FLOW_IMAGE_URL || 'https://flow.google',
      videoUrl: process.env.FLOW_VIDEO_URL || 'https://flow.google',
      ...customConfig
    };

    // 2. Initialize sub-providers
    this.session = new FlowSession(this.config);
    this.downloader = new FlowDownloader(this.config.downloadPath);
    this.imageGenerator = new FlowImageGenerator(this.downloader, this.config);
    this.videoGenerator = new FlowVideoGenerator(this.downloader, this.config);
    this.llmAutomation = new FlowLLMAutomation(this.session, this.config);
  }

  /**
   * Forces initialization of the browser session and triggers manual login fallback if needed.
   */
  async initialize(): Promise<FlowStatus> {
    this.activeTasksCount++;
    try {
      const page = await this.session.getPage();
      const authenticated = await this.session.checkAuthenticated(page);
      return {
        initialized: true,
        authenticated,
        activeTasks: this.activeTasksCount,
        profilePath: this.config.profilePath
      };
    } finally {
      this.activeTasksCount = Math.max(0, this.activeTasksCount - 1);
    }
  }

  /**
   * Generates an image using Google Flow / ImageFX.
   * 
   * @param prompt Textual prompt describing the image.
   */
  async generateImage(prompt: string, options?: ImageGenerationOptions): Promise<ImageGenerationResult> {
    this.activeTasksCount++;
    try {
      const page = await this.session.getPage();
      return await this.imageGenerator.generate(page, prompt, this.config.timeout, options);
    } finally {
      this.activeTasksCount = Math.max(0, this.activeTasksCount - 1);
    }
  }

  /**
   * Generates a video using Google Flow / VideoFX.
   * 
   * @param prompt Textual prompt describing the video.
   */
  async generateVideo(prompt: string, options?: VideoGenerationOptions): Promise<VideoGenerationResult> {
    this.activeTasksCount++;
    try {
      const page = await this.session.getPage();
      return await this.videoGenerator.generate(page, prompt, this.config.timeout, options);
    } finally {
      this.activeTasksCount = Math.max(0, this.activeTasksCount - 1);
    }
  }

  /**
   * Obtains the status of the current Flow session.
   */
  async getStatus(): Promise<FlowStatus> {
    const sessionStatus = await this.session.getStatus();
    return {
      initialized: sessionStatus.initialized,
      authenticated: sessionStatus.authenticated,
      activeTasks: this.activeTasksCount,
      profilePath: this.config.profilePath
    };
  }

  /**
   * Exposes raw download capabilities if manual or external downloads are triggered.
   */
  async download(
    page: Page,
    triggerLocator: Locator,
    prefix: 'image' | 'video',
    subfolder: 'images' | 'videos',
    defaultExt: string
  ): Promise<{ success: boolean; path: string; filename: string; createdAt: string }> {
    return this.downloader.downloadFile(page, triggerLocator, prefix, subfolder, defaultExt);
  }

  /**
   * Optimizes a raw prompt using a web-automated LLM model via Playwright.
   */
  async optimizePrompt(
    model: 'deepseek' | 'claude' | 'chatgpt' | 'gemini',
    prompt: string,
    type: 'image' | 'video'
  ): Promise<string> {
    this.activeTasksCount++;
    try {
      return await this.llmAutomation.optimizePrompt(model, prompt, type);
    } finally {
      this.activeTasksCount = Math.max(0, this.activeTasksCount - 1);
    }
  }

  /**
   * Run the autonomous agent loop to create a complete project.
   */
  async runAgentTask(options: import('./FlowAgent').AgentTaskOptions): Promise<{ success: boolean; jobId: string; videoPath?: string; error?: string }> {
    this.activeTasksCount++;
    try {
      const { flowAgent } = await import('./FlowAgent');
      return await flowAgent.runAutonomousAgent(options);
    } finally {
      this.activeTasksCount = Math.max(0, this.activeTasksCount - 1);
    }
  }

  /**
   * Opens a visible, headful browser session for manual login to the specified portal.
   */
  async openLoginSession(portal: 'google' | 'gemini' | 'chatgpt' | 'claude' | 'deepseek'): Promise<void> {
    await this.session.openLoginSession(portal);
  }

  /**
   * Closes the active browser session. Highly recommended to invoke when finishing operations.
   */
  async close(): Promise<void> {
    await this.session.close();
  }

  // ==========================================
  // FUTURAS EXPANSÕES
  // ==========================================

  async generateAudio(): Promise<unknown> {
    logger.warn('generateAudio() ainda não foi implementado. Preparado para futuras expansões.');
    throw new Error('generateAudio() não implementado.');
  }

  async generateMusic(): Promise<unknown> {
    logger.warn('generateMusic() ainda não foi implementado. Preparado para futuras expansões.');
    throw new Error('generateMusic() não implementado.');
  }

  async generateSpeech(): Promise<unknown> {
    logger.warn('generateSpeech() ainda não foi implementado. Preparado para futuras expansões.');
    throw new Error('generateSpeech() não implementado.');
  }

  async generateAvatar(): Promise<unknown> {
    logger.warn('generateAvatar() ainda não foi implementado. Preparado para futuras expansões.');
    throw new Error('generateAvatar() não implementado.');
  }

  async upscale(): Promise<unknown> {
    logger.warn('upscale() ainda não foi implementado. Preparado para futuras expansões.');
    throw new Error('upscale() não implementado.');
  }

  async batchGenerate(): Promise<unknown[]> {
    logger.warn('batchGenerate() ainda não foi implementado. Preparado para futuras expansões.');
    throw new Error('batchGenerate() não implementado.');
  }
}

// Singleton support for Next.js hot-reloads and concurrent API requests
const globalForFlow = globalThis as unknown as {
  flowProviderInstance?: FlowProvider;
};

export const flowProvider = globalForFlow.flowProviderInstance ?? new FlowProvider();

if (process.env.NODE_ENV !== 'production') {
  globalForFlow.flowProviderInstance = flowProvider;
  
  // Update prototypes of the existing singleton instance and its sub-providers to support hot-reloaded methods
  Object.setPrototypeOf(flowProvider, FlowProvider.prototype);
  if ((flowProvider as any).session) {
    Object.setPrototypeOf((flowProvider as any).session, FlowSession.prototype);
  }
  if ((flowProvider as any).downloader) {
    Object.setPrototypeOf((flowProvider as any).downloader, FlowDownloader.prototype);
  }
  if ((flowProvider as any).imageGenerator) {
    Object.setPrototypeOf((flowProvider as any).imageGenerator, FlowImageGenerator.prototype);
  }
  if ((flowProvider as any).videoGenerator) {
    Object.setPrototypeOf((flowProvider as any).videoGenerator, FlowVideoGenerator.prototype);
  }
  if ((flowProvider as any).llmAutomation) {
    Object.setPrototypeOf((flowProvider as any).llmAutomation, FlowLLMAutomation.prototype);
  }
}

