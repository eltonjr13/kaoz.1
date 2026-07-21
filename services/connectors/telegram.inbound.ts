import type { StoredConnectorAccount } from "./connector.types.ts";
import { isConnectorInboundEnabled } from "./connector.catalog.ts";

export type TelegramImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export interface TelegramInboundMessage {
  message_id?: number;
  chat?: { id?: number; type?: string; title?: string };
  from?: { id?: number; username?: string; first_name?: string; is_bot?: boolean };
  text?: string;
  caption?: string;
  photo?: Array<{ file_id?: string; file_size?: number; width?: number; height?: number }>;
  document?: { file_id?: string; file_name?: string; mime_type?: string; file_size?: number };
}

export interface TelegramImageAttachment {
  fileId: string;
  filename: string;
  mimeType: TelegramImageMimeType;
  size?: number;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

/** Routes explicit image creation requests through the existing Flow image runtime. */
export function requestsTelegramImageGeneration(prompt: string): boolean {
  const value = normalize(prompt);
  return /\b(ger[ea]|cri[ea]|faca|faz|desenh[ea]|imagina|generate|create|draw|make)\b[\s\S]{0,80}\b(imagem|foto|ilustracao|arte|artwork|image|picture)\b/.test(value)
    || /\b(imagem|foto|ilustracao|arte|artwork|image|picture)\b[\s\S]{0,50}\b(ger[ea]|cri[ea]|faca|faz|desenh[ea]|generate|create|draw|make)\b/.test(value);
}

export function telegramImageOperation(prompt: string, hasReference: boolean): "simple" | "reference" | "edit" {
  if (!hasReference) return "simple";
  return /\b(edite|editar|altere|alterar|transforme|transformar|modifique|modificar|troque|trocar|remova|remover|adicione|adicionar|mude|mudar|retoque|retocar)\b/.test(normalize(prompt))
    ? "edit"
    : "reference";
}

export function getTelegramImageAttachment(message: TelegramInboundMessage): TelegramImageAttachment | null {
  const photo = [...(message.photo || [])]
    .filter((item) => item.file_id)
    .sort((a, b) => (b.file_size || (b.width || 0) * (b.height || 0)) - (a.file_size || (a.width || 0) * (a.height || 0)))[0];
  if (photo?.file_id) {
    return { fileId: photo.file_id, filename: `telegram-${message.message_id || "photo"}.jpg`, mimeType: "image/jpeg", size: photo.file_size };
  }

  const document = message.document;
  const declaredMime = document?.mime_type?.split(";", 1)[0].toLowerCase();
  const extension = document?.file_name?.toLowerCase().match(/\.(png|jpe?g|webp)$/)?.[1];
  const mimeType = declaredMime === "image/png" || declaredMime === "image/jpeg" || declaredMime === "image/webp"
    ? declaredMime
    : extension === "png" ? "image/png" : extension === "jpg" || extension === "jpeg" ? "image/jpeg" : extension === "webp" ? "image/webp" : null;
  if (!document?.file_id || !mimeType) return null;
  return { fileId: document.file_id, filename: document.file_name || `telegram-${message.message_id || "image"}`, mimeType, size: document.file_size };
}

export function telegramMessagePrompt(message: TelegramInboundMessage, hasImage: boolean): string {
  const prompt = (message.text || message.caption || "").trim();
  return prompt || (hasImage ? "Crie uma nova imagem baseada na imagem enviada." : "");
}

export function telegramInboundEnabled(account: StoredConnectorAccount): boolean {
  return account.enabled && account.provider === "telegram" && isConnectorInboundEnabled(account.provider, account.publicConfig);
}
