/// <reference types="node" />

export {};

interface HashtagArgs {
  tema: string;
  plataforma: string;
  limite?: number;
}

// Pre-configured tag database mapping common niches to optimized hashtags
const NICHE_TAG_DATABASE: Record<string, { amplas: string[]; nichos: string[] }> = {
  financas: {
    amplas: ["#financas", "#dinheiro", "#investimentos", "#economia"],
    nichos: ["#financaspessoais", "#educacaofinanceira", "#investir", "#poupar", "#fundosimobiliarios", "#acoes"]
  },
  tecnologia: {
    amplas: ["#tecnologia", "#tech", "#gadgets", "#inovacao"],
    nichos: ["#setupgamer", "#ti", "#inteligenciaartificial", "#computador", "#smartphone", "#dicasdetecnologia"]
  },
  programacao: {
    amplas: ["#programacao", "#desenvolvimento", "#codigo", "#software"],
    nichos: ["#javascript", "#python", "#webdev", "#devlife", "#frontend", "#backend", "#estudarprogramacao"]
  },
  culinaria: {
    amplas: ["#culinaria", "#comida", "#gastronomia", "#receitas"],
    nichos: ["#receitasfit", "#comidadeverdade", "#culinariavegana", "#docesgourmet", "#jantarrapido", "#cozinhar"]
  },
  fitness: {
    amplas: ["#fitness", "#academia", "#saude", "#treino"],
    nichos: ["#treinoemcasa", "#dietaflexivel", "#hipertrofia", "#vidasaudavel", "#foco", "#emagrecimento"]
  },
  marketing: {
    amplas: ["#marketing", "#negocios", "#vendas", "#marketingdigital"],
    nichos: ["#marketingdeconteudo", "#tráfegopago", "#branding", "#mktdigital", "#empreendedorismo", "#socialmedia"]
  }
};

const PLATFORM_TAGS: Record<string, string[]> = {
  tiktok: ["#fyp", "#foryou", "#viral", "#tiktokbrasil", "#trend"],
  instagram: ["#reelsinstagram", "#explorepage", "#reelsviral", "#instadaily"],
  youtube: ["#shorts", "#youtubeshorts", "#viralshorts", "#canalnovo"],
  geral: ["#viral", "#trend", "#compartilhe", "#sucesso"]
};

function sanitizeTag(word: string): string {
  return "#" + word
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // remove acentos
    .replace(/[^a-zA-Z0-9]/g, "");   // remove caracteres especiais e espaços
}

function main() {
  try {
    const rawArgs = process.env.KAOZ_SKILL_ARGS || '{}';
    const args: HashtagArgs = JSON.parse(rawArgs);

    const tema = args.tema?.trim();
    const plataforma = args.plataforma?.toLowerCase() || "geral";
    const limite = args.limite || 15;

    if (!tema) {
      throw new Error("O parâmetro 'tema' é obrigatório.");
    }

    // Check if theme matches predefined database
    const sanitizedTema = tema.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    let matchedKey = "";
    for (const key of Object.keys(NICHE_TAG_DATABASE)) {
      if (sanitizedTema.includes(key) || key.includes(sanitizedTema)) {
        matchedKey = key;
        break;
      }
    }

    let amplas: string[] = [];
    let nichos: string[] = [];

    if (matchedKey && NICHE_TAG_DATABASE[matchedKey]) {
      amplas = [...NICHE_TAG_DATABASE[matchedKey].amplas];
      nichos = [...NICHE_TAG_DATABASE[matchedKey].nichos];
    } else {
      // Dynamic fallback generation based on terms
      const words = tema.split(/\s+/).filter(w => w.length > 2);
      words.forEach(word => {
        const cleanTag = sanitizeTag(word);
        if (cleanTag.length > 2) nichos.push(cleanTag);
      });
      amplas.push(sanitizeTag(tema));
      amplas.push("#viral");
      amplas.push("#conteudo");
    }

    // Platform specific tags
    const platformTags = PLATFORM_TAGS[plataforma] || PLATFORM_TAGS.geral;

    // Build balanced list: 40% niche, 40% broad, 20% platform
    const targetNichos = Math.max(1, Math.round(limite * 0.4));
    const targetAmplas = Math.max(1, Math.round(limite * 0.4));
    const targetPlatform = Math.max(1, limite - targetNichos - targetAmplas);

    const selectedNichos = nichos.slice(0, targetNichos);
    const selectedAmplas = amplas.slice(0, targetAmplas);
    const selectedPlatform = platformTags.slice(0, targetPlatform);

    const todasHashtags = Array.from(new Set([...selectedNichos, ...selectedAmplas, ...selectedPlatform])).slice(0, limite);

    const resultado = {
      sucesso: true,
      tema,
      plataforma,
      hashtags: {
        nicho: selectedNichos,
        amplas: selectedAmplas,
        plataforma: selectedPlatform,
      },
      formattedList: todasHashtags.join(" ")
    };

    console.log(JSON.stringify(resultado));
    process.exit(0);
  } catch (e: any) {
    console.error(e.message);
    process.exit(1);
  }
}

main();
