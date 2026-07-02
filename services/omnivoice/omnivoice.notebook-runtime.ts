import { spawn } from "node:child_process";
import { normalizeHttpUrl, writeOmniVoiceSettings } from "./omnivoice.settings";

const PUBLIC_URL_REGEX =
  /https?:\/\/[^\s"'<>]+(?:\.gradio\.live|\.trycloudflare\.com|\.ngrok-free\.app|\.ngrok\.io|\.loca\.lt)[^\s"'<>]*/i;

type NotebookAutomationState = {
  running: boolean;
};

const globalForOmniVoice = globalThis as unknown as {
  omniVoiceNotebookAutomation?: NotebookAutomationState;
};

const automationState = globalForOmniVoice.omniVoiceNotebookAutomation ?? {
  running: false
};

if (process.env.NODE_ENV !== "production") {
  globalForOmniVoice.omniVoiceNotebookAutomation = automationState;
}

function cleanCapturedUrl(value: string): string {
  return normalizeHttpUrl(value.replace(/[),.;]+$/, ""));
}

function getOpenCommand(url: string): { command: string; args: string[] } {
  if (process.platform === "win32") {
    return { command: "cmd", args: ["/c", "start", "", url] };
  }
  if (process.platform === "darwin") {
    return { command: "open", args: [url] };
  }
  return { command: "xdg-open", args: [url] };
}

function openInDefaultBrowser(url: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const { command, args } = getOpenCommand(url);
    const child = spawn(command, args, {
      detached: true,
      stdio: "ignore",
      windowsHide: true
    });

    child.once("error", reject);
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}

export function extractPublicOmniVoiceUrl(text: string): string {
  const match = text.match(PUBLIC_URL_REGEX);
  return match ? cleanCapturedUrl(match[0]) : "";
}

async function runNotebookAutomation(notebookUrl: string): Promise<void> {
  automationState.running = true;

  try {
    await writeOmniVoiceSettings({
      notebookUrl,
      status: "starting",
      lastError: null,
      runStartedAt: new Date().toISOString()
    });

    await openInDefaultBrowser(notebookUrl);
    await writeOmniVoiceSettings({
      status: "waiting_for_login",
      lastError: null
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await writeOmniVoiceSettings({
      status: "error",
      lastError: message
    });
    console.error("[OmniVoice Notebook] Falha ao abrir notebook no navegador padrao:", error);
  } finally {
    automationState.running = false;
  }
}

export function startOmniVoiceNotebook(notebookUrl: string): { started: boolean; message: string } {
  const normalizedNotebookUrl = normalizeHttpUrl(notebookUrl);
  if (!normalizedNotebookUrl) {
    return { started: false, message: "URL do notebook Kaggle invalida." };
  }

  if (automationState.running) {
    return { started: false, message: "O notebook OmniVoice ja esta sendo aberto." };
  }

  void runNotebookAutomation(normalizedNotebookUrl);
  return {
    started: true,
    message: "Notebook OmniVoice aberto no navegador real. Aguardando a URL publica do servidor."
  };
}

export async function captureActiveOmniVoiceUrl(): Promise<string> {
  return "";
}
