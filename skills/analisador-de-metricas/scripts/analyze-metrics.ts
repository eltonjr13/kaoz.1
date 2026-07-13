/// <reference types="node" />

export {};

interface MetricArgs {
  visualizacoes: number;
  curtidas: number;
  comentarios: number;
  compartilhamentos: number;
  salvamentos: number;
  duracaoSegundos: number;
  tempoRetencaoMedio: number;
}

function main() {
  try {
    const rawArgs = process.env.KAOZ_SKILL_ARGS || '{}';
    const args: MetricArgs = JSON.parse(rawArgs);

    const {
      visualizacoes,
      curtidas,
      comentarios,
      compartilhamentos,
      salvamentos,
      duracaoSegundos,
      tempoRetencaoMedio,
    } = args;

    if (
      [visualizacoes, curtidas, comentarios, compartilhamentos, salvamentos, duracaoSegundos, tempoRetencaoMedio].some(
        (val) => val === undefined || isNaN(val) || val < 0
      )
    ) {
      throw new Error("Parâmetros inválidos. Todos os valores numéricos devem ser positivos.");
    }

    if (visualizacoes === 0) {
      throw new Error("O número de visualizações não pode ser zero.");
    }

    if (duracaoSegundos === 0) {
      throw new Error("A duração do vídeo não pode ser zero.");
    }

    if (tempoRetencaoMedio > duracaoSegundos) {
      throw new Error("O tempo de retenção médio não pode ser maior que a duração do vídeo.");
    }

    // Calculations
    const interacoesTotais = curtidas + comentarios + compartilhamentos + salvamentos;
    const taxaEngajamento = (interacoesTotais / visualizacoes) * 100;
    const taxaRetencao = (tempoRetencaoMedio / duracaoSegundos) * 100;
    const taxaCompartilhamento = (compartilhamentos / visualizacoes) * 100;
    const taxaSalvamento = (salvamentos / visualizacoes) * 100;

    // Classifications
    let classificacaoEngajamento = "Regular";
    if (taxaEngajamento >= 10) classificacaoEngajamento = "Excelente";
    else if (taxaEngajamento >= 5) classificacaoEngajamento = "Bom";
    else if (taxaEngajamento >= 2) classificacaoEngajamento = "Médio";
    else classificacaoEngajamento = "Baixo";

    let classificacaoRetencao = "Regular";
    if (taxaRetencao >= 60) classificacaoRetencao = "Viral";
    else if (taxaRetencao >= 40) classificacaoRetencao = "Bom";
    else if (taxaRetencao >= 25) classificacaoRetencao = "Médio";
    else classificacaoRetencao = "Crítico";

    // Diagnosis & Recommendations
    const recomendacoes: string[] = [];
    if (taxaRetencao < 40) {
      recomendacoes.push(
        "O gancho inicial do vídeo (primeiros 3 segundos) falhou em reter o público. Melhore a retenção no início com legendas dinâmicas, cortes mais rápidos e títulos instigantes."
      );
    }
    if (taxaEngajamento < 4) {
      recomendacoes.push(
        "Apesar do alcance, a taxa de interação foi baixa. Adicione uma Call to Action (CTA) explícita e clara ao final do vídeo e na legenda para engajar a audiência."
      );
    }
    if (taxaSalvamento < 0.5) {
      recomendacoes.push(
        "A taxa de salvamentos está baixa. Tente produzir conteúdos educativos, listas, tutoriais ou dicas práticas que o espectador sinta necessidade de salvar para consultar depois."
      );
    }
    if (taxaCompartilhamento < 0.5) {
      recomendacoes.push(
        "A taxa de compartilhamentos está baixa. Crie ganchos de identificação rápida, memes do nicho ou resolva uma dor imediata que faça o espectador querer compartilhar com amigos."
      );
    }
    if (recomendacoes.length === 0) {
      recomendacoes.push("Excelente performance geral! Mantenha a consistência desta estrutura de vídeo.");
    }

    const resultado = {
      sucesso: true,
      metricas: {
        taxaEngajamento: Number(taxaEngajamento.toFixed(2)),
        classificacaoEngajamento,
        taxaRetencao: Number(taxaRetencao.toFixed(2)),
        classificacaoRetencao,
        taxaCompartilhamento: Number(taxaCompartilhamento.toFixed(2)),
        taxaSalvamento: Number(taxaSalvamento.toFixed(2)),
      },
      diagnostico: {
        resumo: `Vídeo com taxa de engajamento de ${taxaEngajamento.toFixed(2)}% (${classificacaoEngajamento}) e retenção de ${taxaRetencao.toFixed(2)}% (${classificacaoRetencao}).`,
        recomendacoes,
      }
    };

    console.log(JSON.stringify(resultado));
  } catch (e: any) {
    console.error(e.message);
    process.exitCode = 1;
  }
}

main();
