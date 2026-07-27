# DaVinci Resolve (local) MCP para Kaoz.1

Servidor MCP local via `stdio` que controla o DaVinci Resolve exclusivamente
pela API oficial de scripting Python (`DaVinciResolveScript` /
`fusionscript.dll`). Não usa mouse, tela, Playwright, atalhos ou execução de
scripts arbitrários.

## Pré-requisitos

- DaVinci Resolve instalado e aberto no Windows.
- Scripting externo habilitado como **Local** nas preferências do Resolve.
- Python compatível com a versão indicada no `README.txt` da API instalada.
- Um caminho absoluto explícito para `python.exe`. O Kaoz.1 não presume nem
  instala silenciosamente um Python global.
- A API instalada do Resolve. Em instalações padrão, consulte primeiro:
  - `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting`
  - `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting\README.txt`
  - `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Developer\Scripting\Modules`
  - `C:\Program Files\Blackmagic Design\DaVinci Resolve\fusionscript.dll`

Os paths podem variar por versão/edição. O `README.txt` instalado junto do
Resolve é a referência autoritativa para a versão local. O Kaoz.1 não copia nem
redistribui `fusionscript.dll`.

## Configuração no Kaoz.1

Em **Configurações → MCP**, adicione o preset **DaVinci Resolve (local)**,
preencha os campos e salve. O preset nasce desabilitado para não conectar ao
Resolve no boot antes de estar completo.

Exemplo persistido em `mcp-settings.json`:

```json
{
  "id": "davinci-resolve-local",
  "presetId": "davinci-resolve-local",
  "name": "DaVinci Resolve (local)",
  "enabled": true,
  "transport": "stdio",
  "command": "C:\\Python312\\python.exe",
  "args": [
    "C:\\caminho-do-runtime-kaoz\\services\\mcp-servers\\davinci-resolve\\server.py"
  ],
  "env": {
    "RESOLVE_SCRIPT_API": "C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting",
    "RESOLVE_SCRIPT_LIB": "C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\fusionscript.dll",
    "RESOLVE_PYTHON_PATH": "C:\\ProgramData\\Blackmagic Design\\DaVinci Resolve\\Support\\Developer\\Scripting\\Modules",
    "KAOZ_RESOLVE_MEDIA_ROOT": "D:\\Media;D:\\Assets",
    "KAOZ_RESOLVE_EXPORT_ROOT": "D:\\Exports"
  }
}
```

O backend fornece o caminho absoluto correto de `server.py` para o runtime em
execução; ele não aceita argumentos extras. Para múltiplas raízes de mídia,
separe caminhos locais por `;`. UNC, curingas, paths relativos e traversal são
bloqueados.

## Segurança e aprovações

- Todas as ferramentas MCP continuam sendo descobertas como
  `mcp:davinci-resolve-local:<toolName>` e executadas pelo
  `ToolExecutionService` / `ExecutionLayer`.
- Como MCP é efeito externo, toda chamada exige aprovação por etapa
  (`approvalMode: "step"`), inclusive leituras.
- Toda mutação exige `requestId`, usado para rastreabilidade e idempotência. Um
  ledger mínimo é persistido na primeira raiz autorizada de exportação.
- Não há ferramenta para Python, Lua, shell, expressão ou script arbitrário.
- O MVP não exclui projetos, mídias, timelines ou render jobs.
- O MVP não substitui nem modifica timelines preexistentes. Montagem,
  marcadores e legendas só são aceitos em timelines criadas pelo MCP com prefixo
  `Kaoz -`.
- Importação e exportação ficam limitadas às raízes configuradas.
- Arquivos existentes não são sobrescritos sem `overwrite=true` explícito e
  aprovado. Renders nunca são sobrescritos.
- `resolve_create_render_job` somente prepara a fila. O render começa apenas
  com uma chamada separada e aprovada a `resolve_start_render`.

Fluxo recomendado:

1. plano;
2. aprovação por etapa;
3. `resolve_create_timeline`;
4. montagem e revisão na timeline nova;
5. `resolve_create_render_job`;
6. aprovação explícita;
7. `resolve_start_render`;
8. polling com `resolve_get_render_status`.

## Diagnóstico e smoke somente leitura

O botão **Testar conexão** inicia o MCP, descobre as ferramentas e chama apenas
`resolve_get_status`. O diagnóstico informa Python, paths da API, carga do
módulo, estado do Resolve, versão, projeto e timeline atuais. Resolve fechado
não derruba o Kaoz.1 nem outros servidores MCP.

Smoke manual opcional, sem mutação:

```powershell
& 'C:\Python312\python.exe' `
  'services\mcp-servers\davinci-resolve\smoke_status.py'
```

Testes mockados, sem instalação real:

```powershell
& 'C:\Python312\python.exe' -m unittest -v `
  'services\mcp-servers\davinci-resolve\test_resolve_bridge.py'
npm.cmd run test:davinci-resolve
```

## Limitações conhecidas

- O Resolve precisa estar aberto; o MCP não o inicia.
- A disponibilidade de scripting externo e alguns métodos varia conforme a
  versão/edição instalada.
- A API oficial tradicional não oferece inserção uniforme de texto de legenda
  em todas as versões. `resolve_add_subtitles` usa `AddSubtitle` somente quando
  o objeto de timeline o expõe; caso contrário retorna
  `SUBTITLE_API_UNAVAILABLE` sem modificar a timeline.
- A seleção temporária de timeline necessária para algumas APIs de exportação e
  Deliver é serializada e a timeline anterior é restaurada.
- Idempotência é mantida pelo ledger
  `.kaoz1-resolve-idempotency.json` na raiz de exportação e por nomes
  rastreáveis de timeline.
- Fusion, color grading, edição por transcrição e edição avançada não fazem
  parte deste MVP.

## Troubleshooting

`RESOLVE_MODULE_UNAVAILABLE`

- Confira se `RESOLVE_SCRIPT_API` aponta para `Developer\Scripting`.
- Confira se `RESOLVE_PYTHON_PATH` aponta para `Scripting\Modules`.
- Confirme a versão de Python indicada pelo `README.txt` instalado.

`RESOLVE_NOT_RUNNING`

- Abra o Resolve.
- Em Preferences, habilite External scripting using **Local**.
- Mantenha um projeto aberto para ferramentas que exigem projeto/timeline.

Falha ao carregar `fusionscript.dll`

- Confira `RESOLVE_SCRIPT_LIB`.
- Não copie a DLL para o Kaoz.1; use o arquivo da instalação local.
- Verifique compatibilidade de arquitetura e versão do Python com o Resolve.

O próximo passo antes de ampliar a integração é executar `resolve_get_status`
em uma instalação real e confirmar a versão local da API.
