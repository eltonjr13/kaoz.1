# Contrato de skills do MrChicken

Use este contrato ao gerar uma skill destinada ao projeto.

## Estrutura aceita

```text
skills/<id>/SKILL.md
skills/<id>/references/<arquivo>.md
skills/<id>/scripts/<arquivo>.ts|js|mjs|cjs|py
```

O ID aceita letras minúsculas, números, ponto e hífen, com até 64 caracteres. Prefira kebab-case e nomes orientados à capacidade.

## Campos do pacote gerado

- `id`: identificador estável da pasta.
- `name`: nome humano.
- `description`: capacidade mais gatilhos de ativação.
- `version`: versão semântica, normalmente `1.0.0` para criação.
- `instructions`: corpo Markdown integral do `SKILL.md`.
- `preferredTools`: IDs de ferramentas existentes que favorecem o fluxo.
- `requiredCapabilities`: subconjunto de `web`, `content`, `system`.
- `approvalMode`: `never`, `plan` ou `step`.
- `tools`: ferramentas executáveis fornecidas pela skill.
- `references`: arquivos textuais auxiliares.
- `scripts`: scripts executáveis auxiliares.

## Ferramentas nativas conhecidas

Use somente quando forem pertinentes:

- `native:web-research`: pesquisar a web.
- `system.summarize`: organizar e limitar texto disponível.
- `native:file-read`: ler texto dentro da raiz autorizada.
- `native:file-write`: gravar texto dentro da raiz autorizada.
- `content:start-video-pipeline`: iniciar um job de vídeo já aprovado.
- `creative:generate-image`: gerar imagem pelo Flow.
- `creative:generate-video`: gerar vídeo pelo Flow.
- `system:run-code`: executar Python ou JavaScript na sandbox local.

Outras ferramentas MCP podem existir em tempo de execução. Só as use se aparecerem na lista fornecida pelo gerador.

## Ferramenta de script

Formato:

```json
{
  "id": "skill:minha-skill:calcular",
  "description": "Calcula o resultado a partir de entradas validadas.",
  "script": "scripts/calcular.ts",
  "inputSchema": {
    "type": "object",
    "required": ["valor"],
    "properties": {
      "valor": {
        "type": "number",
        "description": "Valor usado no cálculo."
      }
    }
  }
}
```

Todo script deve:

1. aceitar os argumentos como JSON no primeiro argumento de processo ou em `KAOZ_SKILL_ARGS`;
2. validar entradas antes de executar;
3. escrever o resultado em JSON no stdout;
4. escrever diagnóstico em stderr somente quando necessário;
5. encerrar com código diferente de zero em falha real;
6. evitar rede ou escrita externa não declarada.

## Regras de consistência

- Cada caminho de ferramenta deve corresponder a um arquivo em `scripts`.
- Cada referência citada nas instruções deve existir no pacote.
- Não crie um script quando uma ferramenta nativa já resolver o trabalho.
- Não declare capacidade sem necessidade operacional.
- Não coloque segredos, tokens ou dados locais em nenhum arquivo gerado.
- Não use caminhos absolutos nos arquivos do pacote.
- Não dependa da pasta de referência usada para inspirar a skill final.
