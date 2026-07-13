---
name: "Gerador de Documentos PDF"
description: "Cria documentos prontos para exportação em PDF a partir de briefing, texto estruturado, rascunhos, relatórios, propostas, atas, manuais e materiais formatados. Ative esta skill quando o pedido envolver criar, montar, revisar, estruturar ou preparar um documento para virar PDF, especialmente quando houver necessidade de paginação, capa, sumário, seções, tabelas, assinatura, identidade visual ou versão final para compartilhamento."
version: "1.0.0"
preferredTools: []
requiredCapabilities: []
approvalMode: plan
enabled: true
tools: []
---
# Objetivo
Crie documentos prontos para exportação em PDF com estrutura clara, linguagem adequada ao contexto e formatação consistente.

# Fluxo
1. Entenda o objetivo do documento, o público, o tom, o idioma, o tamanho esperado e o formato final.
2. Identifique o tipo de documento: proposta, relatório, manual, contrato, apresentação, currículo, ata, catálogo, guia ou outro.
3. Se faltar informação material, faça no máximo duas perguntas curtas e objetivas.
4. Estruture o conteúdo antes da redação final.
5. Produza o documento em Markdown limpo e organizado para conversão em PDF.
6. Garanta que títulos, subtítulos, listas, tabelas e blocos estejam consistentes.
7. Se houver dados sensíveis, preserve somente o necessário e sinalize pontos de revisão.
8. Finalize com uma versão pronta para exportação e, se pedido, com variações de capa, sumário ou layout.

# Regras
- Não invente fatos, datas, preços, nomes, números ou referências.
- Não assuma identidade visual, marca ou padrão editorial sem confirmação.
- Mantenha o texto compatível com PDF: sem dependência de elementos interativos.
- Preserve a hierarquia de títulos e a legibilidade em página impressa.
- Use linguagem objetiva e profissional quando o contexto for corporativo.
- Use linguagem simples e direta quando o contexto for operacional ou didático.
- Se o usuário pedir um PDF com aparência específica, descreva o layout de forma precisa e aplicável.

# Validação
- Verifique se o documento tem começo, meio e fim claros.
- Confirme se há seções obrigatórias do tipo de documento.
- Revise ortografia, coerência e consistência de nomes, datas e valores.
- Cheque se tabelas e listas continuam legíveis em páginas menores.
- Confirme se o conteúdo está pronto para exportação sem dependências externas.

# Uso de ferramentas
- Use apenas ferramentas realmente disponíveis no ambiente.
- Se houver ferramenta de edição de documentos, use-a para estruturar o conteúdo e preparar a versão final.
- Se houver ferramenta de exportação para PDF, use-a ao final para gerar o arquivo.
- Se não houver ferramenta de exportação, entregue o conteúdo em formato pronto para conversão em PDF, com instruções mínimas de exportação se necessário.
- Não invente integração com software, plugins ou APIs inexistentes.

# Saída esperada
- Entregue o documento finalizado ou o conteúdo pronto para exportação.
- Quando útil, inclua também:
  - título do documento;
  - sumário;
  - observações de layout;
  - checklist final de revisão.
