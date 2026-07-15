import { argv } from 'process';

interface InputArgs {
  nomeMarca?: string;
  nicho: string;
  estilo: 'minimalista' | 'moderno' | 'retro' | 'geometrico' | 'emblema' | 'mascote' | 'line-art';
  cores: string[];
  elementos?: string;
}

function translateColor(color: string): string {
  const c = color.toLowerCase().trim();
  const map: Record<string, string> = {
    azul: 'blue',
    verde: 'green',
    vermelho: 'red',
    amarelo: 'yellow',
    laranja: 'orange',
    roxo: 'purple',
    rosa: 'pink',
    preto: 'black',
    branco: 'white',
    cinza: 'gray',
    marrom: 'brown',
    dourado: 'gold',
    prateado: 'silver',
  };
  return map[c] || c;
}

function getStyleKeywords(estilo: string): string {
  switch (estilo) {
    case 'minimalista':
      return 'minimalist vector logo, flat design, clean lines, simple graphic, white background';
    case 'moderno':
      return 'modern sleek vector logo, contemporary design, professional, clean layout, white background';
    case 'retro':
      return 'vintage retro badge logo, classic emblem, distressed textured style, 1970s aesthetic, white background';
    case 'geometrico':
      return 'geometric vector logo, abstract shape, perfect geometry, symmetry, clean minimalist design, white background';
    case 'emblema':
      return 'circular crest emblem logo, traditional shield badge, heraldic seal, detailed vector art, white background';
    case 'mascote':
      return 'mascot character vector logo, friendly character design, clean outlines, iconic illustration, white background';
    case 'line-art':
      return 'minimalist line art logo, continuous line vector drawing, elegant clean lines, simple aesthetic, white background';
    default:
      return 'vector logo design, flat style, minimalist, white background';
  }
}

function main() {
  try {
    const rawArgs = argv[2] || process.env.KAOZ_SKILL_ARGS;
    if (!rawArgs) {
      console.error('Nenhum argumento de entrada fornecido.');
      process.exit(1);
    }
    const input: InputArgs = JSON.parse(rawArgs);

    if (!input.nicho || !input.estilo || !input.cores) {
      console.error('Argumentos obrigatórios ausentes: nicho, estilo ou cores.');
      process.exit(1);
    }

    const brandName = input.nomeMarca ? input.nomeMarca.trim() : '';
    const niche = input.nicho.trim();
    const styleKeywords = getStyleKeywords(input.estilo);
    const translatedColors = input.cores.map(translateColor).join(' and ');
    const elements = input.elementos ? `incorporating ${input.elementos}` : '';

    const prompts = [
      {
        variacao: "Opção 1: Vetor Plano e Limpo (Recomendado para uso geral/SVG)",
        prompt: `A ${styleKeywords} for a "${niche}" business ${brandName ? `named "${brandName}"` : ''}. ${elements}. Color palette: ${translatedColors}. Solid flat vector illustration, smooth curves, high contrast, isolated on a clean white background. No photorealism, no 3D render, no shadows, no gradients.`,
        aspectRatio: "1:1"
      },
      {
        variacao: "Opção 2: Conceito Moderno com Degradê Sutil (Design Premium)",
        prompt: `A premium modern logo concept for a "${niche}" brand${brandName ? ` named "${brandName}"` : ''}, ${styleKeywords}. ${elements}. Colors: ${translatedColors}. Elegant gradients, clean geometry, sleek corporate design, professional graphic identity, isolated on a pure white background. Minimalist look, high resolution vector style.`,
        aspectRatio: "1:1"
      },
      {
        variacao: "Opção 3: Emblema / Carimbo Icônico",
        prompt: `An iconic emblem stamp logo, circle badge design, for "${niche}"${brandName ? ` brand name "${brandName}"` : ''}. ${elements}. Color scheme: ${translatedColors}. Bold outlines, graphic vector element, sticker style, isolated on white background. Clean design, vector artwork.`,
        aspectRatio: "1:1"
      }
    ];

    const result = {
      briefing: {
        nomeMarca: brandName || "Não informado",
        nicho,
        estilo: input.estilo,
        cores: input.cores,
        elementos: input.elementos || "Livre"
      },
      prompts,
      recomendacoes: [
        "Use sempre a proporção 1:1 para logotipos.",
        "Use fundos brancos isolados para facilitar a vetorização posterior.",
        "A IA pode ter dificuldade em soletrar textos complexos. Se o nome da marca vier incorreto, prefira gerar um ícone puro (removendo o nome do prompt) e adicione o texto manualmente no editor de vetor."
      ]
    };

    console.log(JSON.stringify(result, null, 2));
  } catch (err: any) {
    console.error('Falha ao processar os argumentos: ' + err.message);
    process.exit(1);
  }
}

main();