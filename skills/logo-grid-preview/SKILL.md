---
name: "Visualizador de Marca 3x3"
description: "Cria um grid 3x3 de mockups realistas aplicando o logotipo do usuário em 9 mídias/objetos específicos do seu nicho de atuação."
version: "1.0.0"
preferredTools: ["creative:generate-image"]
requiredCapabilities: []
approvalMode: plan
enabled: true
tools: [{"id":"skill:logo-grid-preview:merge-grid","description":"Gera um grid 3x3 mesclando exatamente 9 imagens em uma única imagem JPEG de alta qualidade.","script":"skills/logo-grid-preview/scripts/generate_grid.py","inputSchema":{"type":"object","required":["images","output_path"],"properties":{"images":{"type":"array","description":"Lista com exatamente 9 caminhos dentro do workspace.","items":{"type":"string"}},"output_path":{"type":"string","description":"Caminho de destino dentro de .generated/artifacts."}}},"effect":"write","approvalMode":"plan","policy":{"network":false,"fileRead":"workspace","fileWrite":"artifacts","subprocess":false,"timeoutMs":30000,"maxCpuMs":30000,"maxMemoryMb":256,"maxOutputBytes":1000000}}]
---
# Visualizador de Marca 3x3

Esta skill permite apresentar um logotipo fornecido pelo usuário aplicado de forma realista em um grid 3x3 contendo mockups personalizados de acordo com o nicho de mercado do negócio.

## 1. Papel e Objetivo Operacional
O objetivo desta skill é fornecer ao usuário uma visualização rápida e profissional de como seu logotipo se comporta na prática em diferentes pontos de contato de marca (Papelaria, Merchandising, Digital e Fachada).

### Ativação da Skill
Esta skill é ativada quando o usuário:
- Anexar um arquivo de logotipo (PNG, JPG, SVG) e solicitar ver aplicações práticas.
- Solicitar a criação de "mockups da minha marca", "grid de aplicação de logo", "visualização de marca 3x3".
- Pedir para ver como a marca ficaria em materiais de um nicho específico (ex: "como ficaria meu logo em itens de uma cafeteria?").

---

## 2. Coleta de Contexto Inicial
Antes de iniciar a geração, colete as seguintes informações essenciais:
1. **O Logotipo:** O caminho absoluto do arquivo de imagem do logotipo enviado pelo usuário.
2. **O Nicho de Negócio:** Identifique o nicho (ex: Alimentação/Café, SaaS/Tecnologia, Moda/Vestuário, Beleza/Cosméticos, Arquitetura/Interiores). Caso não esteja explícito, deduza a partir do nome/marca ou faça uma única pergunta rápida ao usuário.
3. **Descrição da Marca:** Uma descrição concisa dos elementos visuais do logotipo (cores, formas, estilo) para auxiliar na criação dos prompts da IA.

---

## 3. Fluxo Principal de Execução

### Passo 1: Seleção do Template por Nicho
Consulte o arquivo de referência [niche_templates.md](references/niche_templates.md) para escolher os 9 tipos de mockups adequados para o nicho identificado. Se o nicho do usuário não constar na lista, projete uma seleção balanceada contendo:
- 2 itens de Papelaria/Corporativo (cartão de visita, papel timbrado, envelopes, pastas).
- 3 itens de Merchandising/Produto (embalagem, sacola, vestuário, copos, brindes).
- 2 itens de Fachada/Ambiente (letreiro externo, recepção, uniforme da equipe, vitrine).
- 2 itens Digitais (tela de celular, favicon, post de rede social, interface de site).

### Passo 2: Geração das Imagens
Para cada um dos 9 itens selecionados, execute a ferramenta `creative:generate-image` com as seguintes especificações:
- **ImagePaths:** Passe uma lista contendo o caminho absoluto do logotipo fornecido pelo usuário para servir de referência direta.
- **Prompt:** Escreva o prompt em inglês para obter melhores resultados de geração. Utilize a estrutura:
  `"A professional photo/mockup of [item] in a realistic [niche] setting, featuring the user's logo applied naturally onto the surface of the [item]. Clean background, studio lighting, photorealistic, 8k resolution, minimalist aesthetic."`
- **Nome da Imagem:** Salve as imagens temporárias em um diretório temporário no formato `mockup_1.jpg` a `mockup_9.jpg` dentro do diretório de artefatos da conversa.

### Passo 3: Mesclagem do Grid 3x3
Após a geração bem-sucedida das 9 imagens, execute a ferramenta `skill:logo-grid-preview:merge-grid` com os parâmetros:
- **images:** Lista contendo os 9 caminhos de arquivos absolutos gerados no Passo 2.
- **output_path:** O caminho final para salvar o grid (ex: `<caminho_da_conversa>/grid_marca_3x3.jpg`).

### Passo 4: Apresentação da Entrega
1. Mostre o grid final utilizando a marcação de imagem do Markdown do MrChicken:
   `![Grid de Aplicação da Marca 3x3](file:///caminho/para/grid_marca_3x3.jpg)`
2. Forneça uma análise minimalista contendo:
   - **Legibilidade:** Como o logotipo se comportou em tamanhos muito pequenos (como favicon ou caneta) vs formatos maiores (letreiro de fachada).
   - **Contraste & Coesão:** Se as cores originais da marca se integram bem a materiais rústicos (ex: papel kraft) ou superfícies brilhantes.
   - **Recomendação de Branding:** Sugestões práticas baseadas nos resultados visuais gerados.

---

## 4. Variantes e Customizações
- **Logotipos com Fundo Escuro/Claro:** Se o logotipo original tiver fundo branco e a aplicação exigir transparência, instrua o modelo de geração no prompt a mesclar ou aplicar como "overlay" ou "embossed".
- **Logotipos puramente Tipográficos:** Enfatize nos prompts que a marca é tipográfica para evitar que a IA tente criar um ícone abstrato no mockup.

---

## 5. Tratamento de Erros e Limites
- **Falha de Geração de Imagem Individual:** Se a geração de um mockup falhar, repita o prompt com uma descrição simplificada. Se falhar novamente, utilize uma imagem cinza neutra com a palavra "Mockup Indisponível" no grid para não travar o processo.
- **Imagens Deformadas:** Se a IA aplicar o logotipo de forma distorcida, instrua o usuário a fornecer uma versão do logo em vetor ou alta definição e reexecute apenas o bloco afetado antes de remontar o grid.

---

## 6. Validação e Qualidade
Antes de dar a tarefa por concluída, certifique-se de que:
- [ ] O grid contém exatamente 9 quadrantes ordenados em 3x3.
- [ ] O logotipo do usuário está visível em cada um dos mockups gerados.
- [ ] O nicho de mercado escolhido faz sentido para o negócio do usuário.
- [ ] O arquivo do grid final foi salvo localmente no caminho correto e exibido na conversa.
