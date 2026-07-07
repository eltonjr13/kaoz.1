type ParsedSpotifyState = {
  is_playing?: boolean;
  device?: {
    name?: string;
  };
  item?: {
    name?: string;
    artists?: string[];
  };
};

type SpotifyResponseContext = {
  text: string;
  state: ParsedSpotifyState | null;
  trackLabel: string | null;
  deviceName?: string;
};

type SpotifyResponseHandler = (context: SpotifyResponseContext) => string;

function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;

  try {
    return JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function parseSpotifyState(text: string): ParsedSpotifyState | null {
  const parsed = parseJsonObject(text);
  if (!parsed) return null;
  return parsed as ParsedSpotifyState;
}

function getTrackLabel(state: ParsedSpotifyState): string | null {
  const trackName = state.item?.name?.trim();
  if (!trackName) return null;

  const artists = Array.isArray(state.item?.artists)
    ? state.item.artists.filter(Boolean).join(", ")
    : "";

  return artists ? `${trackName} - ${artists}` : trackName;
}

function withDevice(message: string, deviceName?: string): string {
  return `${message}${deviceName ? ` no ${deviceName}` : ""}.`;
}

function readableTextOrFallback(text: string, fallback: string): string {
  return text && !text.startsWith("{") ? text : fallback;
}

const RESPONSE_HANDLERS: Record<string, SpotifyResponseHandler> = {
  get_playback_state: ({ state, trackLabel, deviceName }) => {
    if (!trackLabel) return "Nao encontrei nenhuma musica tocando agora.";
    if (state?.is_playing === false) return `No momento esta pausado em ${trackLabel}.`;
    return withDevice(`Agora esta tocando ${trackLabel}`, deviceName);
  },
  play_music: ({ trackLabel, deviceName }) => {
    return trackLabel ? withDevice(`Dei play em ${trackLabel}`, deviceName) : "Dei play no Spotify.";
  },
  pause_music: () => "Pausei o Spotify.",
  next_track: ({ trackLabel }) => trackLabel ? `Pulei para ${trackLabel}.` : "Passei para a proxima faixa.",
  previous_track: ({ trackLabel }) => trackLabel ? `Voltei para ${trackLabel}.` : "Voltei para a faixa anterior.",
  set_volume: () => "Volume ajustado no Spotify.",
  add_to_queue: () => "Adicionei a faixa na fila do Spotify.",
  create_playlist: ({ text }) => readableTextOrFallback(text, "Playlist criada no Spotify."),
  add_tracks_to_playlist: () => "Adicionei as faixas na playlist.",
  transfer_playback: () => "Transferi a reproducao do Spotify."
};

export function formatSpotifyToolResponse(toolName: string, rawText: string, isError = false): string {
  const text = rawText.trim();
  if (isError) return text ? `Nao consegui executar no Spotify: ${text}` : "Nao consegui executar no Spotify.";

  const state = parseSpotifyState(text);
  const handler = RESPONSE_HANDLERS[toolName];
  const context = {
    text,
    state,
    trackLabel: state ? getTrackLabel(state) : null,
    deviceName: state?.device?.name
  };

  return handler ? handler(context) : readableTextOrFallback(text, "Comando executado no Spotify.");
}
