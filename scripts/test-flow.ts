import { FlowProvider } from '../src/providers/flow/FlowProvider';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('[TEST] Inicializando FlowProvider...');
  
  // Set dotenv variables to use the real authenticated profile
  process.env.FLOW_HEADLESS = 'true';
  process.env.FLOW_TIMEOUT = '120000'; // 2 minutes for testing generation
  process.env.FLOW_DOWNLOAD_PATH = 'storage/generated/';
  process.env.FLOW_PROFILE_PATH = 'storage/browser-profile/';
  process.env.FLOW_URL = 'https://flow.google';

  const provider = new FlowProvider();

  try {
    console.log('[TEST] Obtendo status inicial...');
    const status = await provider.getStatus();
    console.log('[TEST] Status obtido:', JSON.stringify(status, null, 2));

    if (!status.authenticated) {
      console.warn('[TEST] AVISO: A sessão não está autenticada. Certifique-se de fazer login pela interface ou rodar em modo headful.');
    }

    console.log('[TEST] Iniciando geração de imagem...');
    const prompt = 'um pato de borracha amarelo na banheira, fofo, render 3d';
    const result = await provider.generateImage(prompt);
    
    console.log('[TEST] Resultado da geração:', JSON.stringify(result, null, 2));

    if (result.success) {
      console.log(`[TEST] Sucesso! Imagem salva em: ${result.path}`);
      // Check if file exists
      if (fs.existsSync(result.path)) {
        console.log('[TEST] Arquivo existe fisicamente no disco!');
      } else {
        console.error('[TEST] ERRO: Arquivo não existe no disco!');
      }
    } else {
      console.error('[TEST] Falha na geração:', result.error);
    }

  } catch (err) {
    console.error('[TEST] Falha durante a execução do teste:', err);
  } finally {
    console.log('[TEST] Fechando provider...');
    await provider.close();
    console.log('[TEST] Teste finalizado.');
  }
}

main().catch(err => {
  console.error('[TEST] Erro fatal no script de teste:', err);
});
