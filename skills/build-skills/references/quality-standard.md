# Padrão de qualidade para skills completas

Use esta referência para transformar conhecimento amplo de um domínio em uma capacidade operacional reutilizável.

## O que caracteriza uma skill profissional

Uma skill completa combina cinco camadas:

1. **Contexto:** define objetivo, público, entradas, restrições e resultado de negócio.
2. **Estratégia:** oferece frameworks e critérios para escolher uma abordagem.
3. **Execução:** descreve passos, ferramentas, formatos e transições.
4. **Especialização:** inclui fórmulas, matrizes, limites, exemplos e variantes do domínio.
5. **Controle de qualidade:** valida a saída e orienta como agir diante de lacunas ou falhas.

O tamanho não é a meta. A meta é reduzir ambiguidades reais sem carregar conhecimento óbvio.

## Anatomia inspirada em skills de alto nível

O exemplo de social content fornecido pelo usuário é forte porque contém:

- perguntas de contexto ligadas ao resultado;
- tabela rápida por plataforma;
- pilares e proporções de conteúdo;
- fórmulas de ganchos categorizadas;
- sistema de reaproveitamento;
- calendário e rotina operacional;
- métricas, diagnóstico e ações corretivas;
- estratégias específicas por plataforma;
- arquivos de referência para detalhes extensos;
- formatos completos para vídeo curto.

Reproduza essa profundidade estrutural no domínio solicitado. Por exemplo:

| Domínio | Framework central | Referências úteis | Validação |
|---|---|---|---|
| Conteúdo social | pilares, hooks, distribuição | plataformas, limites, templates | adequação, retenção, CTA |
| Pesquisa | escopo, fontes, síntese | critérios de fonte, schemas | cobertura, atualidade, citações |
| Documentos | audiência, estrutura, paginação | modelos e regras editoriais | coerência, legibilidade, completude |
| Código | arquitetura, implementação, testes | contratos e padrões do projeto | testes, tipos, regressões |
| Dados | ingestão, limpeza, cálculo | schemas e fórmulas | consistência e reconciliação |

## Profundidade por seção

### Contexto mínimo

Pergunte ou infira apenas o que muda a solução:

- objetivo e ação desejada;
- usuário ou público da saída;
- canal, formato ou ambiente;
- matéria-prima existente;
- restrições e critérios de sucesso.

### Frameworks e decisões

Inclua regras condicionais, como:

- se a entrada for incompleta, usar um caminho seguro e sinalizar suposições;
- se houver múltiplas plataformas, adaptar o formato a cada uma;
- se a operação for repetível e determinística, usar script;
- se a ferramenta não existir, entregar alternativa viável sem fingir execução;
- se houver mudança externa, exigir aprovação adequada.

### Exemplos e templates

Forneça exemplos quando eles eliminarem ambiguidade sobre estrutura, tom ou schema. Um template deve ser diretamente reutilizável e conter campos significativos, não placeholders vagos.

### Formato de saída

Defina a ordem, os blocos obrigatórios, os limites relevantes e como representar erros ou dados ausentes. Quando aplicável, inclua JSON schema, tabela, checklist ou modelo Markdown.

### Validação

Verifique pelo menos:

- correção factual e ausência de invenções;
- aderência às entradas e restrições;
- completude do fluxo;
- consistência entre arquivos;
- acionabilidade da saída;
- funcionamento dos scripts e caminhos declarados.

## Quando dividir em referências

Crie uma referência quando o conteúdo:

- só se aplica a uma variante;
- contém listas extensas, limites ou schemas;
- ultrapassa aproximadamente 100 linhas;
- seria consultado durante a execução, mas não em toda ativação.

Mantenha as referências a um nível de profundidade e ligue cada uma diretamente no `SKILL.md`, explicando quando deve ser lida.

## Antipadrões

Rejeite o rascunho se ele:

- apenas reformular o pedido do usuário;
- disser “analise”, “crie” ou “otimize” sem método;
- depender de conhecimento escondido fora dos arquivos entregues;
- listar ferramentas inexistentes;
- produzir script sem contrato de entrada e saída;
- terminar sem formato de entrega e checklist;
- usar volume de texto para esconder ausência de decisões operacionais.
