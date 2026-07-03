import path from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import { Download, Locator, Page } from "playwright";
import { logger } from "./FlowUtils";

export interface Hunyuan3DBrowserResult {
  modelPaths: string[];
}

const HUNYUAN_URL = process.env.HUNYUAN_3D_URL || "https://3d.hunyuan.tencent.com/";
const HUNYUAN_TIMEOUT = Number(process.env.HUNYUAN_3D_BROWSER_TIMEOUT || 15 * 60 * 1000);
const UI_TEXT = {
  login: "\u767b\u5f55",
  imageTextTo3d: "\u56fe/\u6587\u751f3D",
  imageTo3d: "\u56fe\u751f3D",
  multiImage: "\u591a\u5f20\u56fe\u7247",
  addMultiView: "\u6dfb\u52a0\u591a\u89c6\u56fe",
  frontView: "\u4e0a\u4f20\u6b63\u56fe",
  leftView: "\u4e0a\u4f20\u5de6\u56fe",
  rightView: "\u4e0a\u4f20\u53f3\u56fe",
  backView: "\u4e0a\u4f20\u80cc\u56fe",
  start: "\u5f00\u59cb",
  upload: "\u4e0a\u4f20",
  generate: "\u751f\u6210",
  generateNow: "\u7acb\u5373\u751f\u6210",
  faces500k: "500k",
  download: "\u4e0b\u8f7d",
  confirm: "\u786e\u5b9a",
  agree: "\u540c\u610f",
  gotIt: "\u6211\u77e5\u9053\u4e86"
};

export class Hunyuan3DBrowserGenerator {
  async generate(page: Page, imagePaths: string[], jobId: string): Promise<Hunyuan3DBrowserResult> {
    if (imagePaths.length === 0) {
      throw new Error("Nenhuma imagem aprovada foi informada para gerar o objeto 3D.");
    }

    await page.goto(HUNYUAN_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    await this.waitForShell(page);
    await this.assertLoggedIn(page);
    await this.dismissPopups(page);
    await this.enterImageTextTo3DTool(page);
    await this.selectImageTo3DMode(page);
    await this.uploadImages(page, imagePaths);
    await this.startGeneration(page);
    const modelPaths = await this.waitForDownload(page, jobId);

    return { modelPaths };
  }

  private async waitForShell(page: Page) {
    await page.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});
    await page.waitForTimeout(2500);
  }

  private async assertLoggedIn(page: Page) {
    const url = page.url();
    const loginVisible = await this.firstVisible([
      page.getByText(UI_TEXT.login).first(),
      page.getByText("Log In").first(),
      page.getByText("Sign In").first()
    ]);

    if (url.includes("/login") || url.includes("/signin") || Boolean(loginVisible)) {
      throw new Error("Hunyuan 3D abriu na tela de login. Faca login em Configuracoes > Tencent Hunyuan 3D e tente gerar o objeto novamente.");
    }
  }

  private async dismissPopups(page: Page) {
    const buttons = [
      page.getByText(UI_TEXT.gotIt).first(),
      page.getByText(UI_TEXT.confirm).first(),
      page.getByText(UI_TEXT.agree).first(),
      page.getByText("OK").first(),
      page.getByText("Close").first(),
      page.getByText("Accept").first()
    ];

    for (const button of buttons) {
      if (await button.isVisible().catch(() => false)) {
        await button.click().catch(() => {});
        await page.waitForTimeout(800);
      }
    }
  }

  private async enterImageTextTo3DTool(page: Page) {
    if (await this.isCreationFormVisible(page)) return;

    const toolCard = page.locator("div.tool-item").filter({ hasText: UI_TEXT.imageTextTo3d }).first();
    if (await toolCard.isVisible().catch(() => false)) {
      await toolCard.hover().catch(() => {});
      const startButton = toolCard.locator(".expand-btn").filter({ hasText: UI_TEXT.start }).first();
      if (await startButton.isVisible().catch(() => false)) {
        await startButton.click();
        await this.waitForCreationForm(page);
        return;
      }
    }

    const clickedCard = await page.evaluate(({ title, start }) => {
      const elements = [...document.querySelectorAll<HTMLElement>("div, section, article")];
      const card = elements.find((element) => {
        const rect = element.getBoundingClientRect();
        const text = element.textContent || "";
        return rect.width > 240 && rect.height > 120 && text.includes(title);
      });
      if (!card) return false;

      const action = [...card.querySelectorAll<HTMLElement>("button, div, p, span")].find((element) => {
        const rect = element.getBoundingClientRect();
        const text = element.textContent?.trim() || "";
        return rect.width > 20 && rect.height > 12 && text.includes(start);
      });

      (action || card).click();
      return true;
    }, { title: UI_TEXT.imageTextTo3d, start: UI_TEXT.start });

    if (!clickedCard) {
      const cardText = await this.firstVisible([
        page.getByText(UI_TEXT.imageTextTo3d).first(),
        page.getByText("Image/Text to 3D").first(),
        page.getByText("Image to 3D").first()
      ]);
      if (cardText) {
        await cardText.click();
      }
    }

    await this.waitForCreationForm(page);
  }

  private async waitForCreationForm(page: Page) {
    await page.waitForFunction(() => {
      const text = document.body.textContent || "";
      return Boolean(document.querySelector('input[type="file"]')) ||
        text.includes("\u6dfb\u52a0\u591a\u89c6\u56fe") ||
        text.includes("\u56fe\u751f3D") ||
        text.includes("Multi-view");
    }, null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(800);
  }

  private async isCreationFormVisible(page: Page): Promise<boolean> {
    const hasFileInput = await page.locator('input[type="file"]').count().catch(() => 0) > 0;
    if (hasFileInput) return true;

    const formSignal = await this.firstVisible([
      page.getByText(UI_TEXT.addMultiView),
      page.getByText(UI_TEXT.imageTo3d),
      page.getByText("Multi-view")
    ]);
    return Boolean(formSignal);
  }

  private async selectImageTo3DMode(page: Page) {
    const modeButton = await this.firstVisible([
      page.getByText(UI_TEXT.imageTo3d),
      page.getByText("Image to 3D"),
      page.getByText("Image-to-3D"),
      page.getByText("Multi-view")
    ]);

    if (modeButton) {
      await modeButton.click();
      await page.waitForTimeout(1200);
    }

    const multiImageButton = await this.firstVisible([
      page.getByText(UI_TEXT.multiImage, { exact: true }),
      page.getByText("Multi-image", { exact: true }),
      page.getByText("Multiple images", { exact: true })
    ]);

    if (multiImageButton) {
      await multiImageButton.click();
      await page.waitForTimeout(800);
    }
  }

  private async uploadImages(page: Page, imagePaths: string[]) {
    if (imagePaths.length === 1) {
      await this.uploadSingleImage(page, imagePaths[0], false);
      await this.selectModelFaceCount(page);
      return;
    }

    await this.openMultiViewDialog(page);
    const viewUploads = [
      { labels: [UI_TEXT.frontView, "\u6b63\u56fe"], imagePath: imagePaths[0] },
      { labels: [UI_TEXT.leftView, "\u5de6\u56fe"], imagePath: imagePaths[1] },
      { labels: [UI_TEXT.rightView, "\u53f3\u56fe"], imagePath: imagePaths[2] },
      { labels: [UI_TEXT.backView, "\u80cc\u56fe"], imagePath: imagePaths[3] }
    ].filter((entry) => Boolean(entry.imagePath));

    for (const upload of viewUploads) {
      await this.uploadViewImage(page, upload.labels, upload.imagePath);
    }

    await this.closeMultiViewDialog(page);
    await this.selectModelFaceCount(page);
    await page.waitForTimeout(1500);
  }

  private async uploadSingleImage(page: Page, imagePath: string, forceNewSlot: boolean) {
    await this.ensureUploadInput(page, forceNewSlot);

    const fileInputs = page.locator('input[type="file"]');
    const inputCount = await fileInputs.count();
    if (inputCount === 0) {
      throw new Error("Nao encontrei o campo de upload de imagens no Hunyuan 3D.");
    }
    const fileInput = fileInputs.nth(inputCount - 1);

    logger.info("Fazendo upload de imagem aprovada no Hunyuan 3D.", { imagePath });
    await fileInput.setInputFiles(path.resolve(imagePath));
    await page.waitForTimeout(2500);
  }

  private async ensureUploadInput(page: Page, forceNewSlot = false) {
    if (!forceNewSlot && await page.locator('input[type="file"]').count() > 0) return;

    const uploadButton = await this.firstVisible([
      page.locator('button').filter({ hasText: UI_TEXT.addMultiView }),
      page.getByText(UI_TEXT.upload),
      page.getByText("Upload"),
      page.getByText("Image"),
      page.locator('[class*="upload"]'),
      page.locator('[class*="Upload"]')
    ]);

    if (uploadButton) {
      await uploadButton.click();
      await page.waitForTimeout(1500);
    }
  }

  private async openMultiViewDialog(page: Page) {
    const addMultiViewButton = await this.firstVisible([
      page.locator('button.hy-multiple-views-upload-v2'),
      page.locator('button').filter({ hasText: UI_TEXT.addMultiView }),
      page.locator('[role="button"]').filter({ hasText: UI_TEXT.addMultiView }),
      page.getByText(UI_TEXT.addMultiView),
      page.locator('[class*="multi"], [class*="view"]').filter({ hasText: UI_TEXT.addMultiView })
    ]);

    if (!addMultiViewButton) {
      throw new Error("Nao encontrei o botao de adicionar multi-view no Hunyuan 3D.");
    }

    await addMultiViewButton.click();
    await page.waitForTimeout(1200);
  }

  private async uploadViewImage(page: Page, labels: string[], imagePath: string) {
    const slot = await this.firstVisible(labels.flatMap((label) => [
      page.locator('.hy-multi-view-grid .hy-upload-card').filter({ hasText: label }),
      page.getByText(label, { exact: false })
    ]));
    if (!slot) {
      throw new Error(`Nao encontrei o slot de upload ${labels[0]} no Hunyuan 3D.`);
    }

    logger.info("Fazendo upload de imagem multi-view no Hunyuan 3D.", { label: labels[0], imagePath });
    const fileChooserPromise = page.waitForEvent("filechooser", { timeout: 10000 });
    await slot.click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles(path.resolve(imagePath));
    await page.waitForTimeout(1800);
  }

  private async closeMultiViewDialog(page: Page) {
    await page.keyboard.press("Escape").catch(() => {});
    await page.waitForTimeout(800);

    const dialogStillVisible = await page.locator(".hy-multi-view-grid, .model-dialog, [class*='dialog'], .t-portal-wrapper")
      .filter({ hasText: UI_TEXT.addMultiView })
      .first()
      .isVisible()
      .catch(() => false);
    if (!dialogStillVisible) return;

    const closed = await page.evaluate((title) => {
      const dialogs = [...document.querySelectorAll<HTMLElement>(".t-portal-wrapper, .hy-multi-view-grid, .model-dialog, [class*='dialog']")];
      const dialog = dialogs.find((element) => (element.textContent || "").includes(title));
      if (!dialog) return true;
      const closeButton = [...document.querySelectorAll<HTMLElement>("button, span, div, i")].find((element) => {
        const rect = element.getBoundingClientRect();
        const text = element.textContent?.trim() || "";
        const className = element.className?.toString() || "";
        const visible = [rect.width > 8, rect.height > 8, rect.top >= 0, rect.left >= 0].every(Boolean);
        const nearDialogTop = rect.top < dialog.getBoundingClientRect().top + 80;
        const closeSignal = [text === "\u00d7", text === "x", /close|cancel/i.test(className)].some(Boolean);
        return visible && nearDialogTop && closeSignal;
      });
      if (!closeButton) return false;
      closeButton.click();
      return true;
    }, UI_TEXT.addMultiView);

    if (!closed) {
      throw new Error("Nao consegui fechar o modal de multi-view antes de gerar.");
    }

    await page.waitForTimeout(800);
  }

  private async selectModelFaceCount(page: Page) {
    const clicked = await page.evaluate((faces500k) => {
      const candidates = [...document.querySelectorAll<HTMLElement>("button, [role='button'], div, span")];
      const faceButton = candidates.find((element) => {
        const rect = element.getBoundingClientRect();
        const text = element.textContent?.trim() || "";
        return text === faces500k && rect.width > 20 && rect.width < 140 && rect.height > 16 && rect.height < 80;
      });
      if (!faceButton) return false;
      faceButton.click();
      return true;
    }, UI_TEXT.faces500k);

    if (clicked) await page.waitForTimeout(500);
  }

  private async startGeneration(page: Page) {
    await this.dismissPopups(page);

    if (await this.clickGenerateButton(page)) {
      await page.waitForTimeout(2500);
      return;
    }

    throw new Error("Nao encontrei o botao de gerar no Hunyuan 3D depois do upload.");
  }

  private async clickGenerateButton(page: Page): Promise<boolean> {
    const clicked = await page.evaluate((generateNow) => {
      const isVisibleAction = (element: HTMLElement) => {
        const rect = element.getBoundingClientRect();
        return rect.width >= 40 && rect.height >= 24;
      };
      const isDisabledAction = (element: HTMLElement) => {
        const className = element.className?.toString() || "";
        return element.getAttribute("disabled") !== null ||
          element.getAttribute("aria-disabled") === "true" ||
          className.includes("t-is-disabled");
      };
      const candidates = [...document.querySelectorAll<HTMLElement>(
        ".sideBarLeft-generateBtn, .linear-gradien-button, .t-button, button, [role='button']"
      )];

      for (const element of candidates) {
        const text = element.textContent?.trim() || "";
        if (!text.includes(generateNow) || !isVisibleAction(element) || isDisabledAction(element)) continue;

        element.scrollIntoView({ block: "center", inline: "center" });
        element.click();
        return true;
      }

      return false;
    }, UI_TEXT.generateNow).catch(() => false);
    if (clicked) {
      logger.info("Botao visivel de gerar clicado no Hunyuan 3D.");
      return true;
    }

    const generateButton = await this.firstVisible([
      page.getByRole("button", { name: UI_TEXT.generateNow }).first(),
      page.locator("button").filter({ hasText: UI_TEXT.generateNow }).first(),
      page.locator('[role="button"]').filter({ hasText: UI_TEXT.generateNow }).first(),
      page.locator('[class*="btn"], [class*="button"], [class*="generate"], [class*="submit"]').filter({ hasText: UI_TEXT.generateNow }).first(),
      page.getByRole("button", { name: "Generate" }).first(),
      page.getByRole("button", { name: "Create" }).first()
    ]);

    if (generateButton) {
      await generateButton.click();
      logger.info("Botao de gerar clicado no Hunyuan 3D via locator fallback.");
      return true;
    }

    const clickedGenerate = await page.evaluate((generateNow) => {
      const candidates = [...document.querySelectorAll<HTMLElement>("button, [role='button'], div, span")];
      const button = candidates.find((element) => {
        const rect = element.getBoundingClientRect();
        const text = element.textContent?.trim() || "";
        return rect.width > 40 && rect.height > 24 && text.includes(generateNow);
      });
      if (!button) return false;
      button.click();
      return true;
    }, UI_TEXT.generateNow);

    if (clickedGenerate) logger.info("Botao de gerar clicado no Hunyuan 3D via fallback DOM.");
    return clickedGenerate;
  }

  private async waitForDownload(page: Page, jobId: string): Promise<string[]> {
    const outputDir = path.resolve("storage/generated/3d");
    await mkdir(outputDir, { recursive: true });
    const deadline = Date.now() + HUNYUAN_TIMEOUT;

    while (Date.now() < deadline) {
      const downloadButton = await this.firstVisible([
        page.getByText(UI_TEXT.download).first(),
        page.getByText("Download").first(),
        page.locator('a[download]').first()
      ]);

      if (downloadButton) {
        const downloadPromise = page.waitForEvent("download", { timeout: 120000 });
        await downloadButton.click();
        const download = await downloadPromise.catch(() => null);
        if (download) {
          return this.saveDownload(download, outputDir, jobId);
        }
      }

      const modelUrl = await this.findLoadedModelUrl(page);
      if (modelUrl) {
        return this.downloadModelUrl(modelUrl, outputDir, jobId);
      }

      await page.waitForTimeout(5000);
    }

    throw new Error("Tempo limite aguardando o Hunyuan 3D liberar o download do objeto.");
  }

  private async saveDownload(download: Download, outputDir: string, jobId: string): Promise<string[]> {
    const suggestedName = download.suggestedFilename();
    const ext = path.extname(suggestedName) || ".glb";
    const modelPath = path.join(outputDir, `hunyuan3d_${jobId}${ext}`);
    await download.saveAs(modelPath);
    logger.info("Objeto 3D baixado do Hunyuan.", { modelPath });
    return [modelPath];
  }

  private async findLoadedModelUrl(page: Page): Promise<string | null> {
    return page.evaluate(() => {
      const urls = new Set<string>();
      const html = document.documentElement.innerHTML;
      const htmlMatches = html.match(/https?:\/\/[^"'\s<>]+?\.(?:glb|gltf|obj|fbx)(?:\?[^"'\s<>]*)?/gi) || [];
      htmlMatches.forEach((url) => urls.add(url));

      if (typeof performance !== "undefined") {
        performance
          .getEntriesByType("resource")
          .map((entry) => entry.name)
          .filter((url) => /\.(glb|gltf|obj|fbx)(\?|$)/i.test(url))
          .forEach((url) => urls.add(url));
      }

      return [...urls][0] || null;
    });
  }

  private async downloadModelUrl(modelUrl: string, outputDir: string, jobId: string): Promise<string[]> {
    const response = await fetch(modelUrl);
    if (!response.ok) {
      throw new Error(`Falha ao baixar modelo 3D carregado no Hunyuan: HTTP ${response.status}`);
    }

    const ext = path.extname(new URL(modelUrl).pathname) || ".glb";
    const modelPath = path.join(outputDir, `hunyuan3d_${jobId}${ext}`);
    await writeFile(modelPath, Buffer.from(await response.arrayBuffer()));
    logger.info("Objeto 3D baixado a partir do asset carregado no Hunyuan.", { modelPath });
    return [modelPath];
  }

  private async firstVisible(locators: Locator[]): Promise<Locator | null> {
    for (const locator of locators) {
      const count = await locator.count().catch(() => 0);
      for (let index = 0; index < Math.min(count, 25); index++) {
        const candidate = locator.nth(index);
        if (await candidate.isVisible().catch(() => false)) {
          return candidate;
        }
      }
    }
    return null;
  }
}

export const hunyuan3DBrowserGenerator = new Hunyuan3DBrowserGenerator();
