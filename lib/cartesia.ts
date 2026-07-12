export async function fetchCartesiaVoices(apiKey: string) {
  try {
    const response = await fetch("https://api.cartesia.ai/voices", {
      headers: {
        "X-API-Key": apiKey,
        "Cartesia-Version": "2024-06-10",
      },
    });
    if (!response.ok) {
      throw new Error("Falha ao buscar vozes. Verifique a API Key.");
    }
    const voices = await response.json();
    return voices;
  } catch (error) {
    console.error("Erro ao buscar vozes:", error);
    throw error;
  }
}

export interface PlayCartesiaVoiceResult {
  promise: Promise<void>;
  cancel: () => void;
}

export function playCartesiaVoiceWebSocket(
  apiKey: string,
  voiceId: string,
  text: string,
  model = "sonic-3.5",
  speed = "auto",
  emotion = "auto"
): PlayCartesiaVoiceResult {
  let ws: WebSocket | null = null;
  let audioContext: AudioContext | null = null;
  let isCancelled = false;
  let resolvePromise: (() => void) | null = null;
  const activeSources: AudioBufferSourceNode[] = [];

  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    try {
      if (isCancelled) {
        resolve();
        return;
      }
      const url = `wss://api.cartesia.ai/tts/websocket?api_key=${apiKey}&cartesia_version=2024-06-10`;
      const activeWs = new WebSocket(url);
      ws = activeWs;
      
      const activeAudioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      audioContext = activeAudioContext;
      
      let isFirstChunk = true;
      let nextStartTime = 0;
      let lastSource: AudioBufferSourceNode | null = null;
      const JITTER_BUFFER_SEC = 0.15; // 150ms jitter buffer

      activeWs.onopen = () => {
        if (isCancelled) return;
        const contextId = "mrchicken-" + Date.now().toString() + "-" + Math.random().toString(36).substring(2, 8);
        
        const controls: Record<string, any> = {};
        if (speed && speed !== "auto") {
          controls.speed = speed;
        }
        if (emotion && emotion !== "auto") {
          controls.emotion = [`${emotion}:highest`];
        }

        const voicePayload: Record<string, any> = {
          mode: "id",
          id: voiceId
        };
        if (Object.keys(controls).length > 0) {
          voicePayload.__experimental_controls = controls;
        }

        activeWs.send(JSON.stringify({
          context_id: contextId,
          model_id: model,
          transcript: text,
          voice: voicePayload,
          output_format: {
            container: "raw",
            encoding: "pcm_f32le",
            sample_rate: 44100
          }
        }));
      };

      activeWs.onmessage = async (event) => {
        if (isCancelled) return;
        if (typeof event.data === "string") {
          const data = JSON.parse(event.data);
          if (data.type === "done") {
            activeWs.close();
            if (!lastSource || activeAudioContext.currentTime >= nextStartTime) {
              resolve();
            } else {
              lastSource.onended = () => {
                const idx = activeSources.indexOf(lastSource!);
                if (idx >= 0) activeSources.splice(idx, 1);
                resolve();
              };
            }
          } else if (data.type === "error") {
            activeWs.close();
            reject(new Error(data.error));
          } else if (data.type === "chunk" && data.data) {
            // Decode base64
            const binaryString = atob(data.data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const buffer = bytes.buffer;
            
            // Safe float32 array allocation avoiding alignment range error
            const f32Array = new Float32Array(buffer, 0, Math.floor(buffer.byteLength / 4));
            
            if (f32Array.length === 0) return;

            const audioBuffer = activeAudioContext.createBuffer(1, f32Array.length, 44100);
            audioBuffer.copyToChannel(f32Array, 0);
            
            const source = activeAudioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(activeAudioContext.destination);
            
            if (isFirstChunk) {
              nextStartTime = activeAudioContext.currentTime + JITTER_BUFFER_SEC;
              isFirstChunk = false;
            }

            const playTime = Math.max(activeAudioContext.currentTime, nextStartTime);
            source.start(playTime);
            activeSources.push(source);
            lastSource = source;
            
            nextStartTime = playTime + audioBuffer.duration;
            
            // Cleanup source reference on end
            source.onended = () => {
              const idx = activeSources.indexOf(source);
              if (idx >= 0) activeSources.splice(idx, 1);
            };
          }
        }
      };

      activeWs.onerror = (error) => {
        reject(error);
      };
    } catch (error) {
      reject(error);
    }
  });

  return {
    promise,
    cancel: () => {
      isCancelled = true;
      try {
        ws?.close();
      } catch {}
      activeSources.forEach(s => {
        try { s.stop(); } catch {}
      });
      try {
        audioContext?.close();
      } catch {}
      resolvePromise?.();
    }
  };
}

export interface CartesiaVoiceStream {
  sendChunk: (text: string, isLast: boolean) => void;
  cancel: () => void;
  promise: Promise<void>;
}

export function playCartesiaVoiceStream(
  apiKey: string,
  voiceId: string,
  model = "sonic-3.5",
  speed = "auto",
  emotion = "auto"
): CartesiaVoiceStream {
  let ws: WebSocket | null = null;
  let audioContext: AudioContext | null = null;
  let isCancelled = false;
  const activeSources: AudioBufferSourceNode[] = [];
  
  let isFirstChunk = true;
  let nextStartTime = 0;
  const JITTER_BUFFER_SEC = 0.15;
  const contextId = "mrchicken-" + Date.now().toString() + "-" + Math.random().toString(36).substring(2, 8);
  
  let resolvePromise: () => void = () => {};
  let rejectPromise: (err: Error) => void = () => {};
  
  const promise = new Promise<void>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  try {
    const url = `wss://api.cartesia.ai/tts/websocket?api_key=${apiKey}&cartesia_version=2024-06-10`;
    ws = new WebSocket(url);
    
    audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
  } catch (error) {
    return {
      sendChunk: () => {},
      cancel: () => {},
      promise: Promise.reject(error)
    };
  }
  
  const pendingMessages: Array<{ text: string; isLast: boolean }> = [];
  let isOpened = false;

  const controls: Record<string, any> = {};
  if (speed && speed !== "auto") {
    controls.speed = speed;
  }
  if (emotion && emotion !== "auto") {
    controls.emotion = [`${emotion}:highest`];
  }

  const voicePayload: Record<string, any> = {
    mode: "id",
    id: voiceId
  };
  if (Object.keys(controls).length > 0) {
    voicePayload.__experimental_controls = controls;
  }

  const activeWs = ws;
  const activeAudioContext = audioContext;

  const sendPayload = (text: string, isLast: boolean) => {
    if (activeWs.readyState !== WebSocket.OPEN) return;
    
    const payload: Record<string, any> = {
      context_id: contextId,
      model_id: model,
      transcript: text,
      continue: !isLast,
      output_format: {
        container: "raw",
        encoding: "pcm_f32le",
        sample_rate: 44100
      }
    };
    payload.voice = voicePayload;

    activeWs.send(JSON.stringify(payload));
  };

  activeWs.onopen = () => {
    isOpened = true;
    while (pendingMessages.length > 0) {
      const msg = pendingMessages.shift()!;
      sendPayload(msg.text, msg.isLast);
    }
  };

  let lastSource: AudioBufferSourceNode | null = null;

  activeWs.onmessage = async (event) => {
    if (isCancelled) return;
    if (typeof event.data === "string") {
      const data = JSON.parse(event.data);
      if (data.type === "done") {
        activeWs.close();
        if (!lastSource || activeAudioContext.currentTime >= nextStartTime) {
          resolvePromise();
        } else {
          lastSource.onended = () => {
            const idx = activeSources.indexOf(lastSource!);
            if (idx >= 0) activeSources.splice(idx, 1);
            resolvePromise();
          };
        }
      } else if (data.type === "error") {
        activeWs.close();
        rejectPromise(new Error(data.error));
      } else if (data.type === "chunk" && data.data) {
        // Decode base64
        const binaryString = atob(data.data);
        const len = binaryString.length;
        const bytes = new Uint8Array(len);
        for (let i = 0; i < len; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const buffer = bytes.buffer;
        const f32Array = new Float32Array(buffer, 0, Math.floor(buffer.byteLength / 4));
        if (f32Array.length === 0) return;

        const audioBuffer = activeAudioContext.createBuffer(1, f32Array.length, 44100);
        audioBuffer.copyToChannel(f32Array, 0);
        
        const source = activeAudioContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(activeAudioContext.destination);
        
        if (isFirstChunk) {
          nextStartTime = activeAudioContext.currentTime + JITTER_BUFFER_SEC;
          isFirstChunk = false;
        }

        const playTime = Math.max(activeAudioContext.currentTime, nextStartTime);
        source.start(playTime);
        activeSources.push(source);
        lastSource = source;
        
        nextStartTime = playTime + audioBuffer.duration;
        
        source.onended = () => {
          const idx = activeSources.indexOf(source);
          if (idx >= 0) activeSources.splice(idx, 1);
        };
      }
    }
  };

  activeWs.onerror = (error) => {
    rejectPromise(new Error("WS connection error"));
  };

  const sendChunk = (text: string, isLast: boolean) => {
    if (isCancelled) return;
    if (!isOpened) {
      pendingMessages.push({ text, isLast });
    } else {
      sendPayload(text, isLast);
    }
  };

  const cancel = () => {
    isCancelled = true;
    try { activeWs.close(); } catch {}
    activeSources.forEach(s => {
      try { s.stop(); } catch {}
    });
    try { activeAudioContext.close(); } catch {}
    resolvePromise();
  };

  return {
    sendChunk,
    cancel,
    promise
  };
}
