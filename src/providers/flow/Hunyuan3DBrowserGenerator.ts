import path from "node:path";
import { mkdir } from "node:fs/promises";
import { Download, Page } from "playwright";
import { logger } from "./FlowUtils";

export interface Hunyuan3DBrowserResult {
  modelPaths: string[];
}

const HUNYUAN_URL = process.env.HUNYUAN_3D_URL || "https://3d.hunyuan.tencent.com/";
const HUNYUAN_TIMEOUT = Number(process.env.HUNYUAN_3D_BROWSER_TIMEOUT || 15 * 60 * 1000);

export class Hunyuan3DBrowserGenerator {
  async generate(page: Page, imagePaths: string[], jobId: string): Promise<Hunyuan3DBrowserResult> {
    if (imagePaths.length === 0) {
      throw new Error("Nenhuma imagem aprovada foi informada para gerar o objeto 3D.");
    }

    await page.goto(HUNYUAN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await this.assertLoggedIn(page);
    await this.uploadImages(page, imagePaths);
    await this.startGeneration(page);
    const modelPaths = await this.waitForDownload(page, jobId);

    return { modelPaths };
  }

  private async assertLoggedIn(page: Page) {
    await page.waitForTimeout(2000);
    const url = page.url();
    const loginButton = page.getByText("登录").first();
    if (url.includes("/login") || await loginButton.isVisible().catch(() => false)) {
      throw new Error("Hunyuan 3D abriu na tela de login. Faca login no navegador da automacao e tente gerar o objeto 3D novamente.");
    }
  }

  private async uploadImages(page: Page, imagePaths: string[]) {
    const fileInput = page.locator('input[type="file"]').first();
    if (await fileInput.count() === 0) {
      await this.openUploadPanel(page);
    }

    const availableInput = page.locator('input[type="file"]').first();
    if (await availableInput.count() === 0) {
      throw new Error("Nao encontrei o campo de upload de imagens no Hunyuan 3D.");
    }

    await availableInput.setInputFiles(imagePaths.map((imagePath) => path.resolve(imagePath)));
    await page.waitForTimeout(5000);
  }

  private async openUploadPanel(page: Page) {
    const uploadTriggers = [
      page.getByText("图生3D").first(),
      page.getByText("上传").first(),
      page.getByText("Upload").first(),
      page.getByText("Image").first()
    ];

    for (const trigger of uploadTriggers) {
      if (await trigger.isVisible().catch(() => false)) {
        await trigger.click();
        await page.waitForTimeout(1500);
        return;
      }
    }
  }

  private async startGeneration(page: Page) {
    const generateButton = page.getByText("生成").first();
    if (await generateButton.isVisible().catch(() => false)) {
      await generateButton.click();
      return;
    }

    const createButton = page.getByText("Generate").first();
    if (await createButton.isVisible().catch(() => false)) {
      await createButton.click();
      return;
    }

    throw new Error("Nao encontrei o botao de gerar no Hunyuan 3D depois do upload.");
  }

  private async waitForDownload(page: Page, jobId: string): Promise<string[]> {
    const outputDir = path.resolve("storage/generated/3d");
    await mkdir(outputDir, { recursive: true });
    const deadline = Date.now() + HUNYUAN_TIMEOUT;

    while (Date.now() < deadline) {
      const downloadButton = page.getByText("下载").first();
      if (await downloadButton.isVisible().catch(() => false)) {
        const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
        await downloadButton.click();
        return this.saveDownload(await downloadPromise, outputDir, jobId);
      }

      const englishDownloadButton = page.getByText("Download").first();
      if (await englishDownloadButton.isVisible().catch(() => false)) {
        const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
        await englishDownloadButton.click();
        return this.saveDownload(await downloadPromise, outputDir, jobId);
      }

      await page.waitForTimeout(5000);
    }

    throw new Error("Tempo limite aguardando o Hunyuan 3D liberar o download do objeto.");
  }

  private async saveDownload(
    download: Download,
    outputDir: string,
    jobId: string
  ): Promise<string[]> {
    const suggestedName = download.suggestedFilename();
    const ext = path.extname(suggestedName) || ".glb";
    const modelPath = path.join(outputDir, `hunyuan3d_${jobId}${ext}`);
    await download.saveAs(modelPath);
    logger.info("Objeto 3D baixado do Hunyuan.", { modelPath });
    return [modelPath];
  }
}

export const hunyuan3DBrowserGenerator = new Hunyuan3DBrowserGenerator();
