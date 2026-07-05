import * as fs from 'node:fs';
import * as path from 'node:path';
import { generateFlyJson } from '../lib/ai/fly-json';
import { FlowProvider } from '../src/providers/flow/FlowProvider';

// Carregar .env.local manualmente para o script de teste
function loadEnvLocal() {
  const envLocalPath = path.resolve('.env.local');
  if (fs.existsSync(envLocalPath)) {
    const content = fs.readFileSync(envLocalPath, 'utf8');
    for (const line of content.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const index = trimmed.indexOf('=');
      if (index === -1) continue;
      const key = trimmed.substring(0, index).trim();
      const val = trimmed.substring(index + 1).trim();
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

async function main() {
  loadEnvLocal();

  console.log('--- TESTANDO INTEGRAÇÃO CEREBRAS ---');
  
  if (!process.env.CEREBRAS_API_KEY) {
    console.error('ERRO: CEREBRAS_API_KEY não configurada no .env.local');
    process.exit(1);
  }

  console.log(`CEREBRAS_API_KEY: ${process.env.CEREBRAS_API_KEY.substring(0, 8)}...`);
  console.log(`CEREBRAS_BASE_URL: ${process.env.CEREBRAS_BASE_URL || 'https://api.cerebras.ai/v1'}`);
  console.log(`CEREBRAS_MODEL: ${process.env.CEREBRAS_MODEL || 'gemma-4-31b'}`);

  // Teste 1: Geração de JSON estruturado
  console.log('\n[TESTE 1] Testando generateFlyJson (JSON estruturado)...');
  const jsonPrompt = `Retorne um objeto JSON representando um roteiro de vídeo de 15 segundos sobre o MrChicken. O objeto deve ter as chaves: "titulo", "roteiro" (string) e "tags" (array de strings).`;
  try {
    const jsonResult = await generateFlyJson('cerebras', jsonPrompt);
    console.log('Resultado do JSON:', jsonResult);
    const parsed = JSON.parse(jsonResult);
    if (parsed.titulo && parsed.roteiro && Array.isArray(parsed.tags)) {
      console.log('Sucesso! JSON estruturado válido e com campos corretos.');
    } else {
      console.error('Falha: Objeto JSON não possui os campos esperados.');
    }
  } catch (err) {
    console.error('Erro no Teste 1:', err);
  }

  // Teste 2: Otimização de prompt (não-streaming)
  console.log('\n[TESTE 2] Testando optimizePrompt (não-streaming)...');
  const provider = new FlowProvider();
  try {
    const rawPrompt = 'um pintinho de óculos escuros tocando guitarra no palco';
    const optimized = await provider.optimizePrompt('cerebras', rawPrompt, 'image');
    console.log('Prompt original:', rawPrompt);
    console.log('Prompt otimizado:', optimized);
    if (optimized && optimized.length > rawPrompt.length) {
      console.log('Sucesso! Prompt otimizado retornado.');
    } else {
      console.warn('Aviso: Prompt otimizado é curto ou igual ao original.');
    }
  } catch (err) {
    console.error('Erro no Teste 2:', err);
  }

  // Teste 3: QueryWebLLM com Streaming
  console.log('\n[TESTE 3] Testando queryWebLLM com Streaming...');
  try {
    let chunkCount = 0;
    const queryPrompt = 'Escreva um parágrafo curto parabenizando o time de desenvolvimento do MrChicken.';
    console.log(`Prompt: "${queryPrompt}"`);
    console.log('Chunks recebidos em tempo real:');
    
    const result = await provider.queryWebLLM('cerebras', queryPrompt, undefined, {
      onTextChunk: (chunk) => {
        chunkCount++;
        process.stdout.write(chunk);
      }
    });

    console.log('\n\nResultado completo final:', result);
    console.log(`Sucesso! Total de chunks recebidos: ${chunkCount}`);
    if (chunkCount > 0) {
      console.log('Sucesso! Streaming funcionando corretamente.');
    } else {
      console.error('Falha: Nenhum chunk de streaming recebido.');
    }
  } catch (err) {
    console.error('Erro no Teste 3:', err);
  } finally {
    await provider.close();
  }
}

main().catch(err => {
  console.error('Erro fatal:', err);
});
