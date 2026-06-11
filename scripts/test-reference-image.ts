import { FlowProvider } from '../src/providers/flow/FlowProvider';
import * as fs from 'fs';

async function main() {
  console.log('[TEST] Inicializando FlowProvider...');
  
  // Set dotenv variables to use the real authenticated profile
  process.env.FLOW_HEADLESS = 'false';
  process.env.FLOW_TIMEOUT = '180000'; // 3 minutes for testing generation
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

    console.log('[TEST] Copiando imagem de teste para temp_uploads...');
    const testSrc = 'storage/generated/test_duck.png';
    const testDest = 'storage/temp_uploads/ref_image_test_duck.png';
    
    if (!fs.existsSync(testSrc)) {
      console.error(`[TEST] ERRO: Imagem de teste base não existe em ${testSrc}`);
      return;
    }

    if (!fs.existsSync('storage/temp_uploads')) {
      fs.mkdirSync('storage/temp_uploads', { recursive: true });
    }
    fs.copyFileSync(testSrc, testDest);
    console.log(`[TEST] Imagem copiada para ${testDest}`);

    console.log('[TEST] Iniciando geração de imagem com imagem de referência...');
    const prompt = `um pato de borracha com óculos escuros estiloso baseado na imagem de referência - ${Date.now()}`;
    const result = await provider.generateImage(prompt, {
      aspectRatio: '1:1',
      quantity: 1,
      model: 'Nano Banana 2',
      referenceImage: testDest
    });
    
    console.log('[TEST] Resultado da geração:', JSON.stringify(result, null, 2));

    // Cleanup temp reference image
    try {
      if (fs.existsSync(testDest)) {
        fs.unlinkSync(testDest);
        console.log('[TEST] Imagem de referência temporária removida.');
      }
    } catch (cleanupErr) {
      console.warn('[TEST] Falha ao remover imagem temporária:', cleanupErr);
    }

    if (result.success) {
      console.log(`[TEST] Sucesso! Imagem salva em: ${result.path}`);
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
