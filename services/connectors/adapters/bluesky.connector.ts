import type { ConnectorAdapter } from "../connector.types.ts";
import { loadConnectorMedia } from "../connector.media.ts";

interface BlueskySession { accessJwt: string; did: string; handle: string; }

function serviceUrl(credentials: Record<string, string>) {
  const value = credentials.serviceUrl?.trim() || "https://bsky.social";
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("O servidor Bluesky/PDS precisa usar HTTPS.");
  return url.origin;
}

async function jsonResponse(response: Response) {
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(`Bluesky retornou HTTP ${response.status}: ${String(body.message || body.error || "falha na API")}`);
  return body;
}

async function createSession(credentials: Record<string, string>, signal?: AbortSignal): Promise<BlueskySession> {
  const identifier = credentials.identifier?.trim();
  const password = credentials.appPassword?.trim();
  if (!identifier || !password) throw new Error("Informe o handle/e-mail e a senha de aplicativo do Bluesky.");
  const response = await fetch(`${serviceUrl(credentials)}/xrpc/com.atproto.server.createSession`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier, password }),
    signal
  });
  const body = await jsonResponse(response);
  if (typeof body.accessJwt !== "string" || typeof body.did !== "string" || typeof body.handle !== "string") throw new Error("Sessão Bluesky incompleta.");
  return body as unknown as BlueskySession;
}

export const blueskyConnector: ConnectorAdapter = {
  async test(credentials, signal) {
    const session = await createSession(credentials, signal);
    return { displayName: `@${session.handle}` };
  },

  async publish(_account, credentials, input, signal) {
    const text = input.text.trim();
    if (!text && !input.media?.length) throw new Error("A publicação precisa de texto ou imagem.");
    const session = await createSession(credentials, signal);
    const endpoint = serviceUrl(credentials);
    const record: Record<string, unknown> = {
      $type: "app.bsky.feed.post",
      text,
      createdAt: new Date().toISOString()
    };

    if ((input.media?.length || 0) > 4) throw new Error("O Bluesky aceita no máximo 4 imagens por publicação.");
    if (input.media?.length) {
      const images = [];
      for (const media of input.media) {
        const loaded = await loadConnectorMedia(media, 1_000_000);
        if (!loaded.mimeType.startsWith("image/")) throw new Error("O Bluesky aceita apenas imagens neste conector.");
        const uploaded = await fetch(`${endpoint}/xrpc/com.atproto.repo.uploadBlob`, {
          method: "POST",
          headers: { authorization: `Bearer ${session.accessJwt}`, "content-type": loaded.mimeType },
          body: new Blob([new Uint8Array(loaded.bytes)], { type: loaded.mimeType }),
          signal
        });
        const uploadBody = await jsonResponse(uploaded);
        images.push({ alt: loaded.alt, image: uploadBody.blob });
      }
      record.embed = { $type: "app.bsky.embed.images", images };
    }

    const response = await fetch(`${endpoint}/xrpc/com.atproto.repo.createRecord`, {
      method: "POST",
      headers: { authorization: `Bearer ${session.accessJwt}`, "content-type": "application/json" },
      body: JSON.stringify({ repo: session.did, collection: "app.bsky.feed.post", record }),
      signal
    });
    const body = await jsonResponse(response);
    const uri = typeof body.uri === "string" ? body.uri : "";
    const rkey = uri.split("/").at(-1) || "post";
    return { remoteId: uri || rkey, url: `https://bsky.app/profile/${session.handle}/post/${rkey}` };
  }
};
