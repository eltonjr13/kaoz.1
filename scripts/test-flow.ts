import { FlowProvider } from '../src/providers/flow/FlowProvider';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  console.log('[TEST] Inicializando FlowProvider...');
  
  // Set dotenv variables manually if not loaded
  process.env.FLOW_HEADLESS = 'true';
  process.env.FLOW_TIMEOUT = '30000'; // short timeout for testing status
  process.env.FLOW_DOWNLOAD_PATH = 'storage/generated/';
  process.env.FLOW_PROFILE_PATH = 'storage/browser-profile-test/';
  process.env.FLOW_URL = 'https://labs.google/fx/tools/flow';

  const provider = new FlowProvider();

  try {
    console.log('[TEST] Obtendo status inicial...');
    const status = await provider.getStatus();
    console.log('[TEST] Status obtido com sucesso:', JSON.stringify(status, null, 2));

    console.log('[TEST] Verificando se os diretórios necessários foram criados...');
    const profileExists = fs.existsSync(path.resolve('storage/browser-profile-test/'));
    const downloadDirExists = fs.existsSync(path.resolve('storage/generated/'));

    console.log(`[TEST] Pasta profile existe? ${profileExists}`);
    console.log(`[TEST] Pasta download existe? ${downloadDirExists}`);

    if (downloadDirExists) {
      console.log('[TEST] Sucesso! FlowProvider instanciado e pastas de storage criadas.');
    } else {
      console.error('[TEST] Erro: Pastas de storage não foram criadas.');
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
