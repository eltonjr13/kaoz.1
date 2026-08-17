import { createCreativeArtifact, type CreativeArtifact } from "./creative-artifact.ts";

export type WarRoomAgentRole =
  | "campaign-director"
  | "audience-strategist"
  | "brand-governance"
  | "copywriter"
  | "visual-director"
  | "creative-reviewer";

export interface WarRoomAgentProfile {
  readonly id: string;
  readonly role: WarRoomAgentRole;
  readonly name: string;
  readonly title: string;
  readonly specialty: string;
  readonly avatar: string;
  readonly color: string;
  readonly badge: string;
  readonly systemPrompt: string;
}

export interface WarRoomArtifactReference {
  readonly id: string;
  readonly name: string;
  readonly type: "markdown" | "json" | "document" | "image" | "text";
  readonly summary: string;
  readonly content?: string;
  readonly url?: string;
}

export interface WarRoomMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly agentId: string;
  readonly agentRole: WarRoomAgentRole;
  readonly agentName: string;
  readonly agentTitle: string;
  readonly agentAvatar: string;
  readonly agentColor: string;
  readonly stage: string;
  readonly stageNumber: number;
  readonly totalStages: number;
  readonly thought?: string;
  readonly content: string;
  readonly status: "thinking" | "speaking" | "completed" | "consensus";
  readonly artifactsProduced?: readonly WarRoomArtifactReference[];
  readonly timestamp: string;
}

export interface WarRoomSession {
  readonly id: string;
  readonly executionId: string;
  readonly topic: string;
  readonly status: "initializing" | "in_progress" | "consensus" | "completed" | "failed";
  readonly currentStageIndex: number;
  readonly totalStages: number;
  readonly messages: readonly WarRoomMessage[];
  readonly artifacts: readonly CreativeArtifact[];
  readonly participants: readonly WarRoomAgentProfile[];
  readonly startedAt: string;
  readonly completedAt?: string;
}

export interface WarRoomEvent {
  readonly type: "war_room_init" | "war_room_turn" | "war_room_artifact" | "war_room_consensus" | "war_room_complete";
  readonly sessionId: string;
  readonly payload: Record<string, unknown>;
  readonly timestamp: string;
}

export const WAR_ROOM_AGENT_PROFILES: readonly WarRoomAgentProfile[] = Object.freeze([
  {
    id: "agent-campaign-director",
    role: "campaign-director",
    name: "Alex Vance",
    title: "Diretoria de Estratégia & Campanha",
    specialty: "Alinhamento Estratégico, KPIs e Posicionamento Global",
    avatar: "👑",
    color: "#9D7CFF",
    badge: "Estratégia",
    systemPrompt: "Você é Alex Vance, Diretor de Estratégia. Estabeleça os objetivos da campanha, proposta de valor central, canais prioritários e KPIs mensuráveis.",
  },
  {
    id: "agent-audience-strategist",
    role: "audience-strategist",
    name: "Maya Lin",
    title: "Especialista em Público & Personas",
    specialty: "Mapeamento Comportamental, Dores, Desejos e Segmentos",
    avatar: "🎯",
    color: "#38BDF8",
    badge: "Audiência",
    systemPrompt: "Você é Maya Lin, Estrategista de Audiência. Mapeie as personas-alvo, gatilhos emocionais, objeções comuns e hábitos de consumo de conteúdo.",
  },
  {
    id: "agent-brand-governance",
    role: "brand-governance",
    name: "Valentin Ramos",
    title: "Guardião da Marca & Tom de Voz",
    specialty: "Brand Voice, Diretrizes Éticas, Guardrails e Consistência",
    avatar: "🛡️",
    color: "#34D399",
    badge: "Brand Voice",
    systemPrompt: "Você é Valentin Ramos, Guardião da Marca. Defina o tom de voz (ousado vs sóbrio), regras de conformidade, palavras proibidas e princípios inegociáveis.",
  },
  {
    id: "agent-copywriter",
    role: "copywriter",
    name: "Helena Prado",
    title: "Redatora & Copywriter Viral",
    specialty: "Hooks de Alto Impacto, Roteiros Curtos, Headlines e CTAs",
    avatar: "✍️",
    color: "#F59E0B",
    badge: "Copywriting",
    systemPrompt: "Você é Helena Prado, Copywriter de Alta Conversão. Escreva headlines magnéticas, 3 opções de ganchos virais para Reels/Shorts, estrutura do roteiro e CTAs diretos.",
  },
  {
    id: "agent-visual-director",
    role: "visual-director",
    name: "Theo Becker",
    title: "Diretor de Arte & Conceito Visual",
    specialty: "Moodboard, Paleta de Cores, Composição e Prompts de IA",
    avatar: "🎨",
    color: "#EC4899",
    badge: "Direção Visual",
    systemPrompt: "Você é Theo Becker, Diretor de Arte. Crie o conceito estético, atmosfera visual, iluminação, paleta cromática e prompts precisos para geradores de imagem e vídeo.",
  },
  {
    id: "agent-creative-reviewer",
    role: "creative-reviewer",
    name: "Sofia Alencar",
    title: "Auditora Criativa & Síntese Final",
    specialty: "Checklist de Qualidade, Consenso da Equipe e Aprovação",
    avatar: "🔍",
    color: "#10B981",
    badge: "Revisão & Consenso",
    systemPrompt: "Você é Sofia Alencar, Revisora Chefe. Audite se todas as contribuições atendem aos objetivos iniciais, consolide a síntese executiva e conceda o carimbo de aprovação.",
  },
]);

export function createWarRoomSession(topic: string, executionId?: string): WarRoomSession {
  const now = new Date().toISOString();
  const id = `war-room-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  return Object.freeze({
    id,
    executionId: executionId || id,
    topic: topic.trim(),
    status: "initializing",
    currentStageIndex: 0,
    totalStages: WAR_ROOM_AGENT_PROFILES.length,
    messages: Object.freeze([]),
    artifacts: Object.freeze([]),
    participants: WAR_ROOM_AGENT_PROFILES,
    startedAt: now,
  });
}

export function isWarRoomCommand(text: string): boolean {
  if (!text || typeof text !== "string") return false;
  const normalized = text.trim().toLowerCase();
  return (
    normalized.startsWith("/warroom") ||
    normalized.startsWith("/war-room") ||
    normalized.startsWith("/brainstorm") ||
    normalized.startsWith("/saladeguerra") ||
    normalized.startsWith("/sala-de-guerra")
  );
}

export function extractWarRoomTopic(text: string): string {
  if (!text) return "";
  return text
    .replace(/^(\/warroom|\/war-room|\/brainstorm|\/saladeguerra|\/sala-de-guerra)\s*/i, "")
    .trim();
}

export interface WarRoomTurnResult {
  readonly message: WarRoomMessage;
  readonly artifact?: CreativeArtifact;
  readonly artifactReference?: WarRoomArtifactReference;
  readonly updatedSession: WarRoomSession;
}

export function buildSyntheticAgentTurn(
  session: WarRoomSession,
  agentIndex: number,
  topic: string
): WarRoomTurnResult {
  const profile = WAR_ROOM_AGENT_PROFILES[agentIndex];
  const stageNum = agentIndex + 1;
  const totalStages = WAR_ROOM_AGENT_PROFILES.length;
  const messageId = `msg-${session.id}-${agentIndex}-${Date.now()}`;
  const now = new Date().toISOString();

  let thought = "";
  let content = "";
  let artifactName = "";
  let artifactContent = "";

  switch (profile.role) {
    case "campaign-director":
      thought = `Estruturando a espinha dorsal estratégica para "${topic}" com foco em posicionamento e impacto mensurável.`;
      content = `### 🎯 Diretriz Estratégica & Visão Global\n\nDefinimos o posicionamento para **${topic}** focado em autoridade e alta conversão.\n\n* **Objetivo Primário:** Posicionar a oferta com clareza imediata e geração de valor nos primeiros 3 segundos.\n* **Canais Prioritários:** Reels, TikTok, Instagram Stories e YouTube Shorts.\n* **KPI Principal:** Taxa de Retenção > 45% e Taxa de Conversão de Cliques (CTR) > 3.8%.\n* **Mensagem Central:** Simplicidade, eficiência e transformação real sem promessas vazias.`;
      artifactName = "01_Briefing_Estrategico.md";
      artifactContent = `# Briefing Estratégico: ${topic}\n\n**Data:** ${new Date().toLocaleDateString("pt-BR")}\n**Diretor:** Alex Vance\n\n## 1. Visão Geral\nCampanha estruturada para maximizar awareness e conversão imediata.\n\n## 2. Objetivos & Metas\n- Validação de proposta única de valor (UVP)\n- Retenção qualificada nos canais de topo de funil\n- Geração de leads com alto índice de intenção\n\n## 3. Matriz de Canais\n| Canal | Formato | Frequência | Foco |\n|---|---|---|---|\n| Instagram / Reels | 9:16 Vertical | 3x / semana | Viralidade e Conexão |\n| TikTok | 9:16 Nativo | Diário | Alcance Orgânico |\n| YouTube Shorts | 9:16 Vertical | 2x / semana | Busca & Descoberta |\n`;
      break;

    case "audience-strategist":
      thought = `Identificando as dores latentes, o perfil psicográfico e os gatilhos emocionais da audiência para "${topic}".`;
      content = `### 👥 Mapeamento de Audiência & Gatilhos Emocionais\n\nAnalisamos os segmentos com maior propensão de engajamento para a temática:\n\n* **Persona Principal (O Ocupado Exigente):** Profissionais e criadores que não têm tempo a perder com teorias. Querem soluções práticas e imediatas.\n* **Dor Crítica:** Frustração com ferramentas complicadas e excesso de ruído no mercado.\n* **Gatilho de Decisão:** Prova visual rápida, clareza de processo e segurança.\n* **Barreira / Objeção:** *"Será que isso funciona para a minha realidade?"* (Precisamos quebrar essa objeção no primeiro gancho).`;
      artifactName = "02_Mapeamento_Audiencia.md";
      artifactContent = `# Mapeamento de Audiência: ${topic}\n\n**Estrategista:** Maya Lin\n\n## Personas Mapeadas\n\n### Persona A — O Decisor Pragmático\n- **Idade:** 24 a 45 anos\n- **Motivação:** Eficiência operacional e aumento de resultados\n- **Dores:** Perda de tempo com processos manuais e retrabalho\n- **Desejo:** Solução fluida, rápida e com estética profissional\n\n## Âncora Emocional\n"Eu quero ter o controle e a velocidade sem precisar de uma equipe inteira para executar."\n`;
      break;

    case "brand-governance":
      thought = `Configurando os guardrails da marca, tom de voz e filtros de segurança ética para "${topic}".`;
      content = `### 🛡️ Diretrizes de Marca, Tom de Voz & Guardrails\n\nPara garantir consistência e credibilidade inquestionável:\n\n* **Tom de Voz:** Confiante, técnico, acessível e direto ao ponto. Proibido jargões genéricos de marketing.\n* **Guardrails Inegociáveis:** Não fazer promessas de ganhos milagrosos ou resultados instantâneos irrealistas.\n* **Princípio Estético:** Minimalista, tecnológico e autêntico. Se parece superficial, será descartado.`;
      artifactName = "03_Diretrizes_Marca.md";
      artifactContent = `# Diretrizes de Marca e Guardrails: ${topic}\n\n**Guardião:** Valentin Ramos\n\n## 1. Pilares de Comunicação\n1. **Verdade Técnica:** Todo argumento deve ter embasamento lógico e prático.\n2. **Clareza Absoluta:** Frases diretas, ritmo dinâmico e sem rodeios.\n3. **Postura de Liderança:** Ensinar pelo exemplo e pela demonstração prática.\n\n## 2. Vocabulário Aprovado vs Proibido\n- ✅ **Usar:** *Eficiência real, passo a passo, método comprovado, autonomia, alta precisão.*\n- ❌ **Evitar:** *Fórmula mágica, segredo revelado, riqueza fácil, revolucionário (a menos que provado).*\n`;
      break;

    case "copywriter":
      thought = `Criando hooks magnéticos, roteiro de alta retenção e chamadas para ação cirúrgicas para "${topic}".`;
      content = `### ✍️ Ganchos Virais, Roteiro & Copywriting\n\nAqui estão os ganchos e a estrutura de roteiro com retenção máxima:\n\n* **Hook 1 (Contraste Provocativo):** *"O motivo pelo qual 90% das pessoas falham com ${topic} é exatamente o que ensinaram você a fazer."*\n* **Hook 2 (Velocidade / Desafio):** *"Se você tem menos de 60 segundos, veja como estruturar ${topic} do jeito certo."*\n* **Estrutura de Retenção:** 0-3s: Quebra de padrão ➔ 4-15s: Apresentação da solução ➔ 16-30s: Demonstração prática ➔ 31-45s: Fechamento com CTA simples (*"Comente 'QUERO' para receber o guia completo"*).`;
      artifactName = "04_Copys_e_Roteiros.md";
      artifactContent = `# Roteiro & Copys de Alta Retenção: ${topic}\n\n**Copywriter:** Helena Prado\n\n## Roteiro para Vídeo Curto (Reels / TikTok)\n\n**[00:00 - 00:03] Gancho Visual & Auditivo**\n*(Texto na tela: "Pare de cometer esse erro")*\n"Se você ainda faz ${topic} desse jeito antigo, você está perdendo tempo e dinheiro."\n\n**[00:04 - 00:18] Quebra de Mito & Solução**\n"O segredo não é trabalhar mais horas, é automatizar o que é repetitivo e focar na estratégia pura."\n\n**[00:19 - 00:35] Demonstração Rápida**\n"Olha como funciona na prática em 3 etapas simples..."\n\n**[00:36 - 00:45] Chamada para Ação (CTA)**\n"Salva esse vídeo para consultar depois e confira o link na bio para começar agora."\n`;
      break;

    case "visual-director":
      thought = `Desenhando a estética visual, paleta cromática, iluminação e prompts cinematográficos para "${topic}".`;
      content = `### 🎨 Direção de Arte & Moodboard Visual\n\nEstabelecemos o universo estético e os prompts para os geradores de mídia:\n\n* **Atmosfera:** Cyber-minimalista premium, iluminação de estúdio volumétrica e profundidade de campo suave.\n* **Paleta de Cores:** Fundo Deep Charcoal (#0B0C10), Acentos Violeta Quântico (#9D7CFF) e Ciano (#38BDF8).\n* **Prompt de Imagem (Midjourney / Flow):** \`Cinematic 8k shot, modern studio workspace representing ${topic}, subtle purple and cyan neon ambient light, hyper-realistic, 35mm lens, depth of field, sleek UI holograms --ar 16:9 --style raw\``;
      artifactName = "05_Direcao_Visual_e_Prompts.md";
      artifactContent = `# Direção de Arte e Prompts de Mídia: ${topic}\n\n**Diretor Visual:** Theo Becker\n\n## 1. Identidade Visual da Campanha\n- **Contraste:** Alto contraste com superfícies foscas e acentos em vidro escuro (Dark Glassmorphism).\n- **Tipografia Sugerida:** Inter / Plus Jakarta Sans para legibilidade instantânea em telas móveis.\n\n## 2. Prompts Prontos para Geração\n\n### Capa / Banner (16:9)\n\`\`\`\nProfessional cinematic wide shot, ultra clean creative war room with multi-screen analytics about ${topic}, futuristic minimalism, volumetric soft lighting, 8k resolution --ar 16:9\n\`\`\`\n\n### Story / Reels Cover (9:16)\n\`\`\`\nVertical poster art for ${topic}, high impact typography placement space, vivid gradient light, sharp modern aesthetic --ar 9:16\n\`\`\`\n`;
      break;

    case "creative-reviewer":
      thought = `Auditando a consistência entre estratégia, público, marca, copy e visual para "${topic}". Validando consenso.`;
      content = `### ✅ Auditoria Concluída & Consenso da Equipe\n\nTodos os membros da equipe entregaram suas perspectivas alinhadas:\n\n* **Checklist de Qualidade:** 100% dos critérios atendidos (Estratégia sólida, público refinado, tom respeitado, copy magnética e estética premium).\n* **Consenso da Equipe:** Campanha aprovada sem divergências críticas.\n* **Status:** Pronto para execução e materialização imediata no Live Artifact Canvas.`;
      artifactName = "06_Sintese_Executiva_Aprovada.md";
      artifactContent = `# Síntese Executiva Aprovada: ${topic}\n\n**Auditora Chefe:** Sofia Alencar\n**Status:** ✅ APROVADO COM CONSENSO TOTAL\n\n## Resumo dos Artefatos Gerados\n1. \`01_Briefing_Estrategico.md\` — Alinhamento de KPIs e posicionamento.\n2. \`02_Mapeamento_Audiencia.md\` — Personas e dores prioritárias.\n3. \`03_Diretrizes_Marca.md\` — Guardrails e consistência ética.\n4. \`04_Copys_e_Roteiros.md\` — Ganchos virais e roteiros prontos.\n5. \`05_Direcao_Visual_e_Prompts.md\` — Prompts de imagem/vídeo e estética.\n\n**Próximo Passo:** Execução das etapas de produção e publicação.\n`;
      break;
  }

  const artifactRef: WarRoomArtifactReference = {
    id: `art-${session.id}-${agentIndex}`,
    name: artifactName,
    type: "markdown",
    summary: `${profile.badge}: ${artifactName}`,
    content: artifactContent,
  };

  const domainArtifact = createCreativeArtifact({
    id: artifactRef.id,
    briefId: session.id,
    kind: profile.role,
    name: artifactName,
    status: "ready",
    metadata: {
      agent: profile.name,
      role: profile.role,
      summary: artifactRef.summary,
      content: artifactContent,
    },
    version: 1,
    createdAt: now,
  });

  const message: WarRoomMessage = Object.freeze({
    id: messageId,
    sessionId: session.id,
    agentId: profile.id,
    agentRole: profile.role,
    agentName: profile.name,
    agentTitle: profile.title,
    agentAvatar: profile.avatar,
    agentColor: profile.color,
    stage: profile.title,
    stageNumber: stageNum,
    totalStages,
    thought,
    content,
    status: agentIndex === totalStages - 1 ? "consensus" : "completed",
    artifactsProduced: Object.freeze([artifactRef]),
    timestamp: now,
  });

  const updatedMessages = Object.freeze([...session.messages, message]);
  const updatedArtifacts = Object.freeze([...session.artifacts, domainArtifact]);
  const isComplete = stageNum >= totalStages;

  const updatedSession: WarRoomSession = Object.freeze({
    ...session,
    status: isComplete ? "completed" : "in_progress",
    currentStageIndex: stageNum,
    messages: updatedMessages,
    artifacts: updatedArtifacts,
    completedAt: isComplete ? now : undefined,
  });

  return {
    message,
    artifact: domainArtifact,
    artifactReference: artifactRef,
    updatedSession,
  };
}

export function formatWarRoomEvent(event: WarRoomEvent): string {
  return `event: ${event.type}\ndata: ${JSON.stringify(event.payload)}\n\n`;
}
