---
name: "Analisador de Métricas"
description: "Analisa métricas de engajamento e retenção de vídeos (visualizações, curtidas, comentários, compartilhamentos, salvamentos e retenção) para diagnosticar performance."
version: "1.0.0"
preferredTools: []
requiredCapabilities: []
approvalMode: "plan"
enabled: "true"
tools:
  - id: "skill:analisador-de-metricas:calcular"
    description: "Calcula métricas de performance (engajamento, retenção) de um vídeo e retorna diagnósticos e recomendações estratégicas baseados nos valores."
    script: "scripts/analyze-metrics.ts"
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
---
Você é um especialista em análise de métricas de redes sociais (TikTok, Reels, Shorts).
Sempre que o usuário pedir para avaliar o desempenho de um vídeo, calcular taxas de engajamento ou diagnosticar problemas de retenção:
1. Chame a ferramenta `skill:analisador-de-metricas:calcular` passando todos os parâmetros numéricos solicitados.
2. Apresente o diagnóstico fornecido pela ferramenta de forma clara e estruturada.
3. Adicione recomendações estratégicas baseadas nas falhas de métricas identificadas no relatório da ferramenta (ex: otimizar o gancho se a retenção estiver baixa; criar CTAs fortes para incentivar interações).
