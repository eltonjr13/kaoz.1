"use client";

import { useCallback, useEffect, useState } from "react";
import { CloudDownload, CloudUpload, FolderOpen, Loader2, X } from "lucide-react";
import type {
  GoogleDriveConnectionStatus,
  GoogleDriveSelection,
  GoogleDriveTransferJob,
} from "@/services/google-drive/google-drive.types";

type PickerDocument = { id?: string; name?: string; mimeType?: string; sizeBytes?: number; url?: string };
type PickerData = { action?: string; docs?: PickerDocument[] };
type PickerBuilder = {
  addView(view: unknown): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setCallback(callback: (data: PickerData) => void): PickerBuilder;
  enableFeature(feature: unknown): PickerBuilder;
  setSelectableMimeTypes(value: string): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
};
type DocsView = {
  setIncludeFolders(value: boolean): DocsView;
  setSelectFolderEnabled(value: boolean): DocsView;
};
type GooglePickerApi = {
  picker: {
    Action: { PICKED: string; CANCEL: string };
    Feature: { SUPPORT_DRIVES: unknown };
    ViewId: { DOCS_VIDEOS: unknown; FOLDERS: unknown };
    DocsView: new (viewId: unknown) => DocsView;
    PickerBuilder: new () => PickerBuilder;
  };
};
type GoogleApiLoader = { load(name: string, options: { callback: () => void; onerror: () => void }): void };

type Props = {
  planId?: string;
  renderReady: boolean;
  onImported: (localPath: string, selection: GoogleDriveSelection) => void;
  onStatusMessage: (message: { text: string; type: "success" | "error" | "info" }) => void;
};

let pickerScriptPromise: Promise<void> | null = null;

function pickerApi() {
  return (window as unknown as { google?: GooglePickerApi }).google;
}

function loadPickerScript() {
  if (pickerApi()?.picker) return Promise.resolve();
  if (pickerScriptPromise) return pickerScriptPromise;
  pickerScriptPromise = new Promise<void>((resolve, reject) => {
    const loadPicker = () => {
      const gapi = (window as unknown as { gapi?: GoogleApiLoader }).gapi;
      if (!gapi) return reject(new Error("Carregador do Google Picker indisponível."));
      gapi.load("picker", { callback: resolve, onerror: () => reject(new Error("Falha ao inicializar o Google Picker.")) });
    };
    const existing = document.querySelector<HTMLScriptElement>('script[data-kaoz-google-picker="true"]');
    if (existing) {
      if ((window as unknown as { gapi?: GoogleApiLoader }).gapi) loadPicker();
      else existing.addEventListener("load", loadPicker, { once: true });
      existing.addEventListener("error", () => reject(new Error("Falha ao carregar o Google Picker.")), { once: true });
      return;
    }
    const script = document.createElement("script");
    script.src = "https://apis.google.com/js/api.js";
    script.async = true;
    script.dataset.kaozGooglePicker = "true";
    script.onload = loadPicker;
    script.onerror = () => reject(new Error("Falha ao carregar o Google Picker."));
    document.head.appendChild(script);
  });
  return pickerScriptPromise;
}

export async function pickGoogleDriveFolder() {
  await loadPickerScript();
  const session = await json(await fetch("/api/google-drive", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "picker-session" }),
  })) as { accessToken?: string; apiKey?: string; appId?: string };
  if (!session.accessToken || !session.apiKey || !session.appId) throw new Error("Sessão do Google Picker incompleta.");
  const google = pickerApi();
  if (!google?.picker) throw new Error("Google Picker indisponível.");
  return new Promise<PickerDocument | null>((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true);
    new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(session.accessToken!)
      .setDeveloperKey(session.apiKey!)
      .setAppId(session.appId!)
      .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED && data.docs?.[0]?.id) resolve(data.docs[0]);
        else if (data.action === google.picker.Action.CANCEL) resolve(null);
      })
      .build()
      .setVisible(true);
  });
}

async function json(response: Response) {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(typeof body.error === "string" ? body.error : `HTTP ${response.status}`);
  return body;
}

function percent(job?: GoogleDriveTransferJob | null) {
  if (!job?.totalBytes) return 0;
  return Math.min(100, Math.round((job.bytesTransferred / job.totalBytes) * 100));
}

function importedSelection(job: GoogleDriveTransferJob): GoogleDriveSelection {
  return {
    fileId: job.remoteFileId!,
    name: job.sourceName,
    mimeType: `video/${job.sourceName.split(".").pop() || "mp4"}`,
    sizeBytes: job.totalBytes,
    parentId: job.remoteFolderId,
    webViewLink: job.remoteUrl,
  };
}

function DriveTransferStatus({ transfer, cancel, retry }: { transfer: GoogleDriveTransferJob | null; cancel: () => void; retry: () => void }) {
  if (!transfer) return null;
  const active = ["queued", "transferring"].includes(transfer.status);
  if (active) {
    return (
      <div className="space-y-1">
        <div className="flex items-center gap-2 text-[10px] text-zinc-300"><Loader2 size={11} className="animate-spin" /><span className="flex-1 truncate">{transfer.sourceName}</span><span>{percent(transfer)}%</span><button type="button" onClick={cancel} aria-label="Cancelar transferência"><X size={12} /></button></div>
        <div className="h-1 overflow-hidden rounded-full bg-white/10"><div className="h-full bg-blue-400 transition-all" style={{ width: `${percent(transfer)}%` }} /></div>
      </div>
    );
  }
  if (transfer.status === "failed" || transfer.status === "cancelled") {
    return <button type="button" onClick={retry} className="w-full rounded-lg border border-amber-500/25 bg-amber-500/10 px-2 py-1.5 text-[10px] font-bold text-amber-200 hover:bg-amber-500/20">Repetir transferência</button>;
  }
  return transfer.status === "completed" && transfer.kind === "upload" && transfer.remoteUrl
    ? <a className="block truncate text-[10px] font-bold text-blue-300 hover:underline" href={transfer.remoteUrl} target="_blank" rel="noreferrer">Abrir vídeo enviado no Google Drive</a>
    : null;
}

function DriveControlButtons(props: {
  busy: string | null;
  connection: GoogleDriveConnectionStatus | null;
  renderReady: boolean;
  planId?: string;
  openPicker: (kind: "video" | "folder") => void;
  upload: () => void;
}) {
  const { busy, connection, renderReady, planId, openPicker, upload } = props;
  return (
    <>
      <div className="grid grid-cols-2 gap-2">
        <button type="button" disabled={!!busy || !connection?.connected} onClick={() => openPicker("video")} className="flex items-center justify-center gap-1.5 rounded-[6px] bg-[#242832] px-2 py-2 text-[10px] font-semibold text-[#D5D8E0] hover:bg-[#303541] disabled:opacity-40"><CloudDownload size={13} /> Importar vídeo</button>
        <button type="button" disabled={!!busy || !connection?.connected} onClick={() => openPicker("folder")} className="flex items-center justify-center gap-1.5 rounded-[6px] px-2 py-2 text-[10px] font-semibold text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200 disabled:opacity-40"><FolderOpen size={13} /> Escolher destino</button>
      </div>
      <button type="button" disabled={!!busy || !connection?.connected || !connection.defaultFolder || !renderReady || !planId} onClick={upload} className="flex w-full items-center justify-center gap-1.5 rounded-[6px] bg-[#7C6CF2] px-2 py-2 text-[10px] font-semibold text-white hover:bg-[#8B7CF6] disabled:opacity-40"><CloudUpload size={13} /> Enviar render ao Drive</button>
    </>
  );
}

function transferOutcome(job: GoogleDriveTransferJob) {
  if (job.status === "completed" && job.kind === "download" && job.localPath && job.remoteFileId) {
    return { terminal: true, message: "Vídeo importado do Google Drive e pronto para análise.", type: "success" as const, localPath: job.localPath, selection: importedSelection(job) };
  }
  if (job.status === "completed") return { terminal: true, message: "Vídeo editado enviado ao Google Drive.", type: "success" as const };
  if (job.status === "failed") return { terminal: true, message: job.error || "Transferência do Google Drive falhou.", type: "error" as const };
  if (job.status === "cancelled") return { terminal: true, message: "Transferência cancelada.", type: "info" as const };
  return { terminal: false };
}

export function GoogleDriveVideoControls({ planId, renderReady, onImported, onStatusMessage }: Props) {
  const [connection, setConnection] = useState<GoogleDriveConnectionStatus | null>(null);
  const [transfer, setTransfer] = useState<GoogleDriveTransferJob | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const loadStatus = useCallback(async () => {
    const data = await json(await fetch("/api/google-drive", { cache: "no-store" })) as { status?: GoogleDriveConnectionStatus; transfers?: GoogleDriveTransferJob[] };
    setConnection(data.status || null);
    setTransfer((current) => current || data.transfers?.[0] || null);
  }, []);

  useEffect(() => {
    loadStatus().catch(() => undefined);
  }, [loadStatus]);

  useEffect(() => {
    if (!transfer || !["queued", "transferring"].includes(transfer.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const data = await json(await fetch(`/api/google-drive?transferId=${encodeURIComponent(transfer.id)}`, { cache: "no-store" })) as { transfer?: GoogleDriveTransferJob };
        if (!data.transfer) return;
        const next = data.transfer;
        setTransfer(next);
        const outcome = transferOutcome(next);
        if (!outcome.terminal) return;
        setBusy(null);
        if (outcome.localPath && outcome.selection) onImported(outcome.localPath, outcome.selection);
        onStatusMessage({ text: outcome.message!, type: outcome.type! });
      } catch (error) {
        setBusy(null);
        onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [onImported, onStatusMessage, transfer]);

  async function session() {
    if (!connection?.connected) throw new Error("Conecte o Google Drive nas Configurações primeiro.");
    await loadPickerScript();
    const data = await json(await fetch("/api/google-drive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "picker-session" }),
    })) as { accessToken?: string; apiKey?: string; appId?: string };
    if (!data.accessToken || !data.apiKey || !data.appId) throw new Error("Sessão do Google Picker incompleta.");
    return data as { accessToken: string; apiKey: string; appId: string };
  }

  async function openPicker(kind: "video" | "folder") {
    setBusy(`picker:${kind}`);
    try {
      const auth = await session();
      const google = pickerApi();
      if (!google?.picker) throw new Error("Google Picker indisponível.");
      const view = new google.picker.DocsView(kind === "video" ? google.picker.ViewId.DOCS_VIDEOS : google.picker.ViewId.FOLDERS)
        .setIncludeFolders(kind === "folder")
        .setSelectFolderEnabled(kind === "folder");
      const builder = new google.picker.PickerBuilder()
        .addView(view)
        .setOAuthToken(auth.accessToken)
        .setDeveloperKey(auth.apiKey)
        .setAppId(auth.appId)
        .enableFeature(google.picker.Feature.SUPPORT_DRIVES)
        .setCallback((data) => {
          if (data.action !== google.picker.Action.PICKED || !data.docs?.[0]?.id) return;
          const selected = data.docs[0];
          void (kind === "video" ? importVideo(selected) : rememberFolder(selected));
        });
      if (kind === "video") builder.setSelectableMimeTypes("video/mp4,video/quicktime,video/x-matroska,video/webm,video/x-msvideo");
      builder.build().setVisible(true);
    } catch (error) {
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function importVideo(document: PickerDocument) {
    setBusy("import");
    try {
      const data = await json(await fetch("/api/google-drive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "import", fileId: document.id }),
      })) as { transfer?: GoogleDriveTransferJob };
      if (!data.transfer) throw new Error("A importação não foi iniciada.");
      setTransfer(data.transfer);
      onStatusMessage({ text: "Baixando o vídeo do Google Drive para edição local.", type: "info" });
    } catch (error) {
      setBusy(null);
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
    }
  }

  async function rememberFolder(document: PickerDocument) {
    setBusy("folder");
    try {
      const data = await json(await fetch("/api/google-drive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "set-folder", fileId: document.id, name: document.name }),
      })) as { status?: GoogleDriveConnectionStatus };
      setConnection(data.status || connection);
      onStatusMessage({ text: `Pasta ${document.name || "selecionada"} definida como destino padrão.`, type: "success" });
    } catch (error) {
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function upload() {
    if (!planId) return;
    setBusy("upload");
    try {
      const data = await json(await fetch("/api/google-drive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "upload", planId }),
      })) as { transfer?: GoogleDriveTransferJob };
      if (!data.transfer) throw new Error("O upload não foi iniciado.");
      setTransfer(data.transfer);
      if (data.transfer.status === "completed") {
        setBusy(null);
        onStatusMessage({ text: "Este render já foi enviado ao Google Drive.", type: "success" });
      } else {
        onStatusMessage({ text: "Enviando o vídeo editado ao Google Drive.", type: "info" });
      }
    } catch (error) {
      setBusy(null);
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
    }
  }

  async function cancel() {
    if (!transfer) return;
    await fetch("/api/google-drive", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel", transferId: transfer.id }),
    }).catch(() => undefined);
  }

  async function retry() {
    if (!transfer) return;
    setBusy("retry");
    try {
      const data = await json(await fetch("/api/google-drive", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "retry", transferId: transfer.id }),
      })) as { transfer?: GoogleDriveTransferJob };
      if (!data.transfer) throw new Error("A transferência não foi reiniciada.");
      setTransfer(data.transfer);
      onStatusMessage({ text: "Transferência reiniciada.", type: "info" });
    } catch (error) {
      setBusy(null);
      onStatusMessage({ text: error instanceof Error ? error.message : String(error), type: "error" });
    }
  }

  return (
    <div className="space-y-2 border-y border-white/[0.07] py-3">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-widest text-[#8B92A1]">Google Drive</span>
        <span className={`text-[10px] ${connection?.connected ? "text-emerald-400" : "text-zinc-500"}`}>{connection?.connected ? connection.email || "Conectado" : "Conecte nas Configurações"}</span>
      </div>
      <DriveControlButtons busy={busy} connection={connection} renderReady={renderReady} planId={planId} openPicker={(kind) => void openPicker(kind)} upload={() => void upload()} />
      {connection?.defaultFolder && <p className="truncate text-[10px] text-zinc-500">Destino: {connection.defaultFolder.name}</p>}
      <DriveTransferStatus transfer={transfer} cancel={() => void cancel()} retry={() => void retry()} />
    </div>
  );
}
