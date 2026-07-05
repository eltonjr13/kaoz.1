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

export async function playCartesiaVoiceWebSocket(
  apiKey: string,
  voiceId: string,
  text: string,
  model = "sonic-3.5",
  speed = "auto",
  emotion = "auto"
) {
  return new Promise<void>((resolve, reject) => {
    try {
      const url = `wss://api.cartesia.ai/tts/websocket?api_key=${apiKey}&cartesia_version=2024-06-10`;
      const ws = new WebSocket(url);
      
      const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
      let nextStartTime = audioContext.currentTime;

      ws.onopen = () => {
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

        ws.send(JSON.stringify({
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

      ws.onmessage = async (event) => {
        if (typeof event.data === "string") {
          const data = JSON.parse(event.data);
          if (data.type === "chunk" && data.data) {
            // Decode base64
            const binaryString = atob(data.data);
            const len = binaryString.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
              bytes[i] = binaryString.charCodeAt(i);
            }
            const buffer = bytes.buffer;
            const f32Array = new Float32Array(buffer);
            
            const audioBuffer = audioContext.createBuffer(1, f32Array.length, 44100);
            audioBuffer.copyToChannel(f32Array, 0);
            
            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);
            
            const playTime = Math.max(audioContext.currentTime, nextStartTime);
            source.start(playTime);
            nextStartTime = playTime + audioBuffer.duration;
          } else if (data.type === "done") {
            ws.close();
            // Resolve quickly after receiving done
            setTimeout(() => resolve(), 2000);
          } else if (data.type === "error") {
            ws.close();
            reject(new Error(data.error));
          }
        }
      };

      ws.onerror = (error) => {
        reject(error);
      };
    } catch (error) {
      reject(error);
    }
  });
}
