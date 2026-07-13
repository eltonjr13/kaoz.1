---
name: "Analisador de Métricas"
description: "Analisa métricas de engajamento e retenção de vídeos (visualizações, curtidas, comentários, compartilhamentos, salvamentos e retenção) para diagnosticar performance. Aceita dados manuais ou um link direto do vídeo."
version: "1.1.0"
preferredTools: []
requiredCapabilities: []
approvalMode: "plan"
enabled: "true"
tools:
  - id: "skill:analisador-de-metricas:calcular"
    description: "Calcula métricas de performance (engajamento, retenção) de um vídeo e retorna diagnósticos e recomendações estratégicas baseados nos valores."
    script: "skills/analisador-de-metricas/scripts/analyze-metrics.ts"
    inputSchema:
      type: "object"
      required: ["visualizacoes", "curtidas", "comentarios", "compartilhamentos", "salvamentos", "duracaoSegundos", "tempoRetencaoMedio"]
      properties:
        visualizacoes:
          type: "number"
          description: "Número total de visualizações do vídeo."
        curtidas:
          type: "number"
          description: "Número total de curtidas."
        comentarios:
          type: "number"
          description: "Número total de comentários."
        compartilhamentos:
          type: "number"
          description: "Número total de compartilhamentos."
        salvamentos:
          type: "number"
          description: "Número total de salvamentos."
        duracaoSegundos:
          type: "number"
          description: "Duração total do vídeo em segundos."
        tempoRetencaoMedio:
          type: "number"
          description: "Tempo médio de retenção dos espectadores em segundos."
  - id: "skill:analisador-de-metricas:analisar-url"
    description: "Recebe o link de um vídeo (YouTube, TikTok ou Instagram), extrai automaticamente as métricas públicas via scraping e retorna o diagnóstico completo de engajamento."
    script: "skills/analisador-de-metricas/scripts/fetch-and-analyze.ts"
    inputSchema:
      type: "object"
      required: ["url"]
      properties:
        url:
          type: "string"
          description: "URL do vídeo (YouTube, TikTok ou Instagram)."
---
Você é um especialista em análise de métricas de redes sociais (TikTok, Reels, Shorts).

Quando o usuário enviar um **link de vídeo** (YouTube, TikTok ou Instagram):
1. Chame a ferramenta `skill:analisador-de-metricas:analisar-url` passando a URL.
2. Apresente o diagnóstico de forma clara e estruturada com as métricas extraídas.

Quando o usuário fornecer **dados numéricos manualmente**:
1. Chame a ferramenta `skill:analisador-de-metricas:calcular` passando todos os parâmetros.
2. Apresente o diagnóstico fornecido pela ferramenta.

Em ambos os casos, adicione recomendações estratégicas baseadas nas falhas identificadas (ex: otimizar o gancho se a retenção estiver baixa; criar CTAs fortes para incentivar interações).

