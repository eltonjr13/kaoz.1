import WebSocket from 'ws';
import fs from 'fs';

// Substitua pelo IP/URL do seu servidor onde o FastAPI está rodando
const WS_URL = 'ws://127.0.0.1:7862/stream';

async function testOmniVoiceStream() {
  console.log(`Conectando ao OmniVoice em ${WS_URL}...`);
  const ws = new WebSocket(WS_URL);

  let chunkCount = 0;
  // Criamos um arquivo de saída onde todo o áudio será concatenado (WAV é perdoável com concatenação bruta de dados, embora o cabeçalho fique duplicado. Para o teste, serve).
  const writeStream = fs.createWriteStream('./teste_saida_stream.wav');

  ws.on('open', () => {
    console.log('✅ Conectado! Enviando requisição de texto...');
    
    // O payload que o servidor espera
    const payload = {
      text: "Olá, testando o sistema de baixa latência. Se tudo der certo, essa frase vai ser quebrada em blocos. E o áudio vai começar a tocar muito rápido!",
      language: "pt",
      mode: "design",
      instruct: "female, young adult, portuguese accent",
      steps: 8
    };

    ws.send(JSON.stringify(payload));
    console.time('TempoAtePrimeiroAudio');
  });

  ws.on('message', (data: Buffer | string, isBinary: boolean) => {
    if (isBinary) {
      chunkCount++;
      if (chunkCount === 1) {
        console.timeEnd('TempoAtePrimeiroAudio');
      }
      console.log(`[+] Recebido chunk de áudio #${chunkCount} (${(data as Buffer).length} bytes)`);
      writeStream.write(data);
    } else {
      // É uma mensagem JSON (conclusão ou erro)
      const msg = JSON.parse(data.toString());
      if (msg.type === 'done') {
        console.log(`\n🎉 Geração finalizada!`);
        console.log(`Latência inicial: ${msg.first_latency_sec}s`);
        console.log(`Tempo total: ${msg.total_time_sec}s`);
        console.log(`Total de blocos: ${msg.chunks}`);
        ws.close();
      } else if (msg.type === 'error') {
        console.error('❌ Erro no servidor:', msg.message);
        ws.close();
      }
    }
  });

  ws.on('close', () => {
    console.log('Conexão encerrada.');
    writeStream.close();
    console.log('Áudio salvo em "teste_saida_stream.wav".');
  });

  ws.on('error', (err) => {
    console.error('Erro no WebSocket:', err);
  });
}

testOmniVoiceStream();
