/**
 * Contratos do motor Cortex derivado do MaleCNS.
 *
 * Três estruturas com responsabilidades explícitas (plano, seção 4):
 *  1. dados duráveis  — permanecem nos formatos existentes de memória/conversa;
 *  2. motor derivado  — matriz esparsa + parâmetros versionados → scores/estado;
 *  3. observabilidade — rastros de seleção que alimentam a UI do Cortex.
 *
 * Nada aqui armazena conteúdo de memória: apenas IDs, scores e metadados.
 */
export {};
