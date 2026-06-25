"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  Bot,
  Sparkles,
  Cpu,
  Send,
  Zap,
  Check,
  CheckCircle,
  Download,
  AlertCircle,
  ArrowRight,
  ChevronRight,
  Image as ImageIcon,
  Film,
  FileText,
  Loader2,
  Play,
  Copy,
  Terminal,
  Volume2,
  Plus
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";

interface Avatar {
  id: string;
  name: string;
  image_path: string;
}

interface FlyModeWizardProps {
  avatars: Avatar[];
  selectedAvatarId: string;
  setSelectedAvatarId: (id: string) => void;
  agentModel: 'gemini' | 'chatgpt' | 'claude' | 'deepseek';
  setAgentModel: (model: 'gemini' | 'chatgpt' | 'claude' | 'deepseek') => void;
  useCortexMemory: boolean;
}

interface AdCreativeConcept {
  conceptName: string;
  copyText: string;
  visualPrompt: string;
  explanation: string;
}

interface ReactVideoConcept {
  title: string;
  topic: string;
  hook: string;
  voiceoverScript: string;
  explanation: string;
}

interface SocialCaption {
  platform: string;
  captionText: string;
  callToAction: string;
}

interface CampaignPlan {
  campaignName: string;
  tagline: string;
  objective: string;
  targetAudience: {
    demographic: string;
    painPoints: string[];
    desires: string[];
  };
  valueProposition: string;
  avatarRecommendation: {
    avatarId: string;
    rationale: string;
  };
  recommendedAdCreatives: AdCreativeConcept[];
  recommendedReactVideos: ReactVideoConcept[];
  socialCaptions: SocialCaption[];
}

interface JobState {
  jobId: string;
  status: "idle" | "running" | "completed" | "failed";
  logs: string[];
  resultPath?: string;
  resultPaths?: string[];
  error?: string;
}

export function FlyModeWizard({
  avatars,
  selectedAvatarId,
  setSelectedAvatarId,
  agentModel,
  setAgentModel,
  useCortexMemory,
}: FlyModeWizardProps) {
  const [step, setStep] = useState<"briefing" | "diagnose" | "planning" | "blueprint">("briefing");
  const [campaignGoal, setCampaignGoal] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Diagnosis Step
  const [questions, setQuestions] = useState<string[]>([]);
  const [answers, setAnswers] = useState<string[]>(["", "", ""]);

  // Planning Step
  const [progressMessage, setProgressMessage] = useState("Coordenando decisões estratégicas...");
  const [plan, setPlan] = useState<CampaignPlan | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "creatives" | "videos" | "captions">("overview");

  // Job Launch state
  const [launchedJobs, setLaunchedJobs] = useState<Record<string, JobState>>({});

  // Presets for briefing
  const presets = [
    "Copos térmicos com design estético para jovens profissionais no Instagram.",
    "Curso de finanças pessoais de forma bem humorada e direta no TikTok.",
    "Roupas sustentáveis focando em minimalismo e responsabilidade ambiental."
  ];

  // Auto-close toast / clipboard alerts
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  // Poll job events for launched projects/ad-creatives
  useEffect(() => {
    const activeJobIds = Object.keys(launchedJobs).filter(
      (key) => launchedJobs[key].status === "running"
    );
    if (activeJobIds.length === 0) return;

    let isMounted = true;
    const interval = setInterval(async () => {
      if (!isMounted) return;

      const nextJobs = { ...launchedJobs };
      let updated = false;

      for (const key of activeJobIds) {
        const jobState = nextJobs[key];
        try {
          // Poll events
          const eventsRes = await fetch(`/api/jobs/events?jobId=${jobState.jobId}`);
          if (!eventsRes.ok) continue;
          const eventsData = await eventsRes.json();
          const events = eventsData.events || [];

          // Poll job status
          const jobRes = await fetch(`/api/jobs?jobId=${jobState.jobId}`);
          if (!jobRes.ok) continue;
          const jobData = await jobRes.json();
          const job = jobData.jobs?.[0];

          if (job) {
            updated = true;
            const newLogs = events.map(
              (e: any) => `[${new Date(e.created_at).toLocaleTimeString()}] ${e.message}`
            );

            nextJobs[key] = {
              ...jobState,
              logs: newLogs.length > 0 ? newLogs : jobState.logs,
            };

            if (job.status === "completed") {
              nextJobs[key].status = "completed";
              nextJobs[key].resultPath = job.final_video_path || "";
              
              // Extract images if ad-creative
              try {
                const parsed = JSON.parse(job.source_video_transcription);
                if (parsed && typeof parsed === "object") {
                  if (parsed.mode === 'ad-creative' && Array.isArray(parsed.concepts)) {
                    nextJobs[key].resultPaths = parsed.concepts.flatMap((c: any) => c.images || []);
                  } else if (Array.isArray(parsed)) {
                    nextJobs[key].resultPaths = parsed;
                  } else if (Array.isArray(parsed.images)) {
                    nextJobs[key].resultPaths = parsed.images.map((item: any) => item.path || item);
                  }
                }
              } catch {}
            } else if (job.status === "failed") {
              nextJobs[key].status = "failed";
              nextJobs[key].error = job.error_message || "Falha na geração.";
            }
          }
        } catch (err) {
          console.error("Erro no polling do Modo Fly:", err);
        }
      }

      if (updated && isMounted) {
        setLaunchedJobs(nextJobs);
      }
    }, 3000);

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [launchedJobs]);

  // Step 1: Diagnose
  const handleStartDiagnosis = async () => {
    if (!campaignGoal.trim()) {
      setError("Por favor, descreva o objetivo da sua campanha.");
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/fly/diagnose", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaignGoal }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Erro ao gerar diagnóstico.");
      }
      setQuestions(data.questions || []);
      setAnswers(["", "", ""]);
      setStep("diagnose");
    } catch (err: any) {
      setError(err.message || "Erro de conexão. Tente novamente.");
    } finally {
      setIsLoading(false);
    }
  };

  // Step 2: Generate Plan
  const handleGeneratePlan = async () => {
    setIsLoading(true);
    setError(null);
    setStep("planning");

    // Dynamic loader messages
    const messages = [
      "Processando briefing e diagnóstico...",
      "Analisando perfil do público-alvo...",
      "Mapeando conceitos de anúncios de imagem...",
      "Projetando roteiros de vídeo de react...",
      "Finalizando o plano de campanha definitivo..."
    ];
    let msgIdx = 0;
    const interval = setInterval(() => {
      msgIdx = (msgIdx + 1) % messages.length;
      setProgressMessage(messages[msgIdx]);
    }, 2000);

    try {
      const res = await fetch("/api/fly/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          campaignGoal,
          questions,
          answers,
          avatarId: selectedAvatarId,
          model: agentModel,
        }),
      });
      const data = await res.json();
      clearInterval(interval);

      if (!res.ok || !data.success) {
        throw new Error(data.error || "Erro ao gerar o plano de campanha.");
      }
      setPlan(data.plan);
      setStep("blueprint");
    } catch (err: any) {
      clearInterval(interval);
      setError(err.message || "Erro ao gerar o plano.");
      setStep("diagnose");
    } finally {
      setIsLoading(false);
    }
  };

  // Launch Ad Creative
  const handleLaunchAdCreative = async (concept: AdCreativeConcept, index: number) => {
    const key = `ad-${index}`;
    if (launchedJobs[key]?.status === "running") return;

    setLaunchedJobs((prev) => ({
      ...prev,
      [key]: {
        jobId: "",
        status: "running",
        logs: ["Iniciando o Piloto para criativos de imagem..."],
      },
    }));

    try {
      const res = await fetch("/api/flow/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-project",
          prompt: concept.copyText,
          avatarId: selectedAvatarId,
          useAvatarPersonality: true,
          useCortexMemory,
          model: agentModel,
          aspectRatio: "1:1",
          imageModel: "Nano Banana Pro",
          imageQuantity: "x4",
          approvedPlan: {
            flow: "ad-creative",
            optimizedPrompt: concept.visualPrompt,
            explanation: concept.explanation,
            useCortexMemory,
            adCreativePlan: {
              concepts: [
                {
                  conceptName: concept.conceptName,
                  copyText: concept.copyText,
                  visualPrompt: concept.visualPrompt,
                },
              ],
            },
          },
        }),
      });
      const data = await res.json();
      if (data.success && data.jobId) {
        setLaunchedJobs((prev) => ({
          ...prev,
          [key]: {
            jobId: data.jobId,
            status: "running",
            logs: [`Job criado com ID: ${data.jobId}. Aguardando início do processamento...`],
          },
        }));
      } else {
        throw new Error(data.error || "Falha na API de criação.");
      }
    } catch (err: any) {
      setLaunchedJobs((prev) => ({
        ...prev,
        [key]: {
          jobId: "",
          status: "failed",
          logs: [`Erro: ${err.message || String(err)}`],
          error: err.message || String(err),
        },
      }));
    }
  };

  // Launch React Video
  const handleLaunchReactVideo = async (video: ReactVideoConcept, index: number) => {
    const key = `video-${index}`;
    if (launchedJobs[key]?.status === "running") return;

    setLaunchedJobs((prev) => ({
      ...prev,
      [key]: {
        jobId: "",
        status: "running",
        logs: ["Iniciando Piloto para criação de vídeo React..."],
      },
    }));

    try {
      const res = await fetch("/api/flow/agent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "create-project",
          prompt: video.topic,
          avatarId: selectedAvatarId,
          useAvatarPersonality: true,
          useCortexMemory,
          model: agentModel,
          videoModel: "Veo 3.1",
          approvedPlan: {
            flow: "project",
            optimizedPrompt: video.topic,
            explanation: video.explanation,
            strategy: video.hook,
            scriptOutline: video.voiceoverScript,
            useCortexMemory,
          },
        }),
      });
      const data = await res.json();
      if (data.success && data.jobId) {
        setLaunchedJobs((prev) => ({
          ...prev,
          [key]: {
            jobId: data.jobId,
            status: "running",
            logs: [`Job de React criado com ID: ${data.jobId}. Processando em segundo plano...`],
          },
        }));
      } else {
        throw new Error(data.error || "Falha ao criar o projeto.");
      }
    } catch (err: any) {
      setLaunchedJobs((prev) => ({
        ...prev,
        [key]: {
          jobId: "",
          status: "failed",
          logs: [`Erro: ${err.message || String(err)}`],
          error: err.message || String(err),
        },
      }));
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  return (
    <div className="mx-auto w-full max-w-[1100px] text-white">
      {/* Step Container */}
      <AnimatePresence mode="wait">
        {/* Step 1: Briefing */}
        {step === "briefing" && (
          <motion.div
            key="briefing"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="flex flex-col gap-6"
          >
            {/* Header */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-2">
                <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#9D7CFF]/20 border border-[#9D7CFF]/45">
                  <Zap size={14} className="text-[#9D7CFF]" />
                </span>
                <span className="text-[11px] font-bold uppercase tracking-widest text-[#9D7CFF]">
                  Piloto Automático (Modo Fly)
                </span>
              </div>
              <h2 className="text-2xl font-light tracking-tight">Otimização & Coordenação de Anúncios</h2>
              <p className="text-sm text-white/50 max-w-xl">
                O piloto automático coordenará a melhor estratégia. Ele fará perguntas diagnósticas personalizadas sobre a sua marca para estruturar criativos e vídeos de alta conversão.
              </p>
            </div>

            {/* Form Box */}
            <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-md flex flex-col gap-5">
              <div className="flex flex-col gap-2">
                <label className="text-xs font-semibold text-white/85">O que você quer vender ou promover nesta campanha?</label>
                <textarea
                  value={campaignGoal}
                  onChange={(e) => setCampaignGoal(e.target.value)}
                  placeholder="Ex: Copos térmicos de cores pastéis para pessoas que trabalham de home office e amam café..."
                  className="min-h-[110px] w-full rounded-2xl border border-white/10 bg-black/40 p-4 text-sm text-white placeholder-white/30 outline-none focus:border-[#9D7CFF]/50 transition-colors"
                />
              </div>

              {/* Presets */}
              <div className="flex flex-col gap-2">
                <span className="text-[10px] font-bold uppercase tracking-wider text-white/45">Exemplos rápidos:</span>
                <div className="flex flex-wrap gap-2">
                  {presets.map((p, idx) => (
                    <button
                      key={idx}
                      onClick={() => setCampaignGoal(p)}
                      className="rounded-xl border border-white/5 bg-white/[0.03] px-3 py-1.5 text-xs text-white/60 hover:border-[#9D7CFF]/30 hover:bg-[#9D7CFF]/5 hover:text-white transition-all cursor-pointer"
                    >
                      {p}
                    </button>
                  ))}
                </div>
              </div>

              {/* Settings selectors */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                {/* Avatar */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-white/85">Avatar da Campanha</label>
                  <div className="relative">
                    <select
                      value={selectedAvatarId}
                      onChange={(e) => setSelectedAvatarId(e.target.value)}
                      className="w-full appearance-none rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-xs text-white/80 outline-none cursor-pointer"
                    >
                      {avatars.map((a) => (
                        <option key={a.id} value={a.id}>
                          {a.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Model */}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-semibold text-white/85">Cérebro da IA</label>
                  <select
                    value={agentModel}
                    onChange={(e) => setAgentModel(e.target.value as any)}
                    className="w-full appearance-none rounded-xl border border-white/10 bg-black/40 px-3 py-2.5 text-xs text-white/80 outline-none cursor-pointer"
                  >
                    <option value="gemini">Gemini 2.5 (Recomendado)</option>
                    <option value="chatgpt">ChatGPT GPT-4o</option>
                    <option value="claude">Claude 3.5 Sonnet</option>
                    <option value="deepseek">DeepSeek R1</option>
                  </select>
                </div>
              </div>

              {error && (
                <div className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 p-3 text-xs text-red-400">
                  <AlertCircle size={14} />
                  <span>{error}</span>
                </div>
              )}

              {/* Submit */}
              <button
                disabled={isLoading}
                onClick={handleStartDiagnosis}
                className="mt-2 flex min-h-[48px] items-center justify-center gap-2 rounded-2xl bg-[#9D7CFF] px-6 text-sm font-semibold text-black transition-all hover:bg-[#b096ff] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              >
                {isLoading ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    <span>Iniciando Piloto...</span>
                  </>
                ) : (
                  <>
                    <span>Iniciar Piloto Automático</span>
                    <ArrowRight size={16} />
                  </>
                )}
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 2: Diagnose Questions */}
        {step === "diagnose" && (
          <motion.div
            key="diagnose"
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            className="flex flex-col gap-6"
          >
            {/* Header */}
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-widest text-[#9D7CFF]">
                  Etapa de Diagnóstico
                </span>
              </div>
              <h2 className="text-xl font-light tracking-tight">Perguntas Estratégicas do Piloto</h2>
              <p className="text-xs text-white/50">
                Responda às questões abaixo para calibrar e gerar as melhores copys e roteiros.
              </p>
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/[0.02] p-6 backdrop-blur-md flex flex-col gap-5">
              {questions.map((q, idx) => (
                <div key={idx} className="flex flex-col gap-2">
                  <span className="text-xs font-semibold text-white/85">
                    {idx + 1}. {q}
                  </span>
                  <textarea
                    value={answers[idx]}
                    onChange={(e) => {
                      const next = [...answers];
                      next[idx] = e.target.value;
                      setAnswers(next);
                    }}
                    placeholder="Responda aqui..."
                    className="min-h-[70px] w-full rounded-xl border border-white/10 bg-black/40 p-3 text-sm text-white placeholder-white/30 outline-none focus:border-[#9D7CFF]/50 transition-colors"
                  />
                </div>
              ))}

              {/* Actions */}
              <div className="flex items-center gap-3 mt-2">
                <button
                  onClick={() => setStep("briefing")}
                  className="flex min-h-[46px] items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] px-4 text-xs font-semibold text-white hover:bg-white/5 cursor-pointer"
                >
                  Voltar
                </button>
                <button
                  disabled={isLoading}
                  onClick={handleGeneratePlan}
                  className="flex-1 flex min-h-[46px] items-center justify-center gap-2 rounded-xl bg-[#9D7CFF] px-6 text-xs font-semibold text-black transition-all hover:bg-[#b096ff] cursor-pointer"
                >
                  {isLoading ? (
                    <>
                      <Loader2 size={14} className="animate-spin" />
                      <span>Coordenando Campanha...</span>
                    </>
                  ) : (
                    <>
                      <span>Gerar Plano de Campanha Otimizado</span>
                      <Sparkles size={14} />
                    </>
                  )}
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {/* Step 3: Planning Progress */}
        {step === "planning" && (
          <motion.div
            key="planning"
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            className="flex flex-col items-center justify-center text-center py-20 gap-4"
          >
            <div className="relative flex items-center justify-center">
              <span className="absolute h-16 w-16 rounded-full bg-[#9D7CFF]/20 animate-ping" />
              <div className="h-12 w-12 rounded-full border border-[#9D7CFF]/50 bg-[#9D7CFF]/10 flex items-center justify-center">
                <Bot size={20} className="text-[#9D7CFF] animate-bounce" />
              </div>
            </div>
            <div className="flex flex-col gap-1 mt-2">
              <h3 className="text-sm font-semibold tracking-wider text-white">Piloto Automático Coordenando</h3>
              <p className="text-xs text-white/50 font-mono tracking-wide">{progressMessage}</p>
            </div>
          </motion.div>
        )}

        {/* Step 4: Blueprint Dashboard */}
        {step === "blueprint" && plan && (
          <motion.div
            key="blueprint"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex flex-col gap-6"
          >
            {/* Header */}
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-white/5 pb-4">
              <div className="flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="flex h-5 w-5 items-center justify-center rounded bg-[#9D7CFF]/20 text-[9px] font-bold text-[#9D7CFF]">
                    FLY
                  </span>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#9D7CFF]">
                    Plano de Campanha Gerado
                  </span>
                </div>
                <h1 className="text-xl font-semibold tracking-tight">{plan.campaignName}</h1>
                <p className="text-xs text-white/50 italic">&ldquo;{plan.tagline}&rdquo;</p>
              </div>
              <button
                onClick={() => setStep("briefing")}
                className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs font-semibold text-white hover:bg-white/10 cursor-pointer"
              >
                Nova Campanha
              </button>
            </div>

            {/* Dashboard grid */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left Column: Intelligence Overview (3 cols) */}
              <div className="lg:col-span-4 flex flex-col gap-5 rounded-3xl border border-white/10 bg-white/[0.02] p-5 backdrop-blur-md">
                <h2 className="text-xs font-bold uppercase tracking-wider text-white/80 border-b border-white/5 pb-2">
                  Visão Geral Estratégica
                </h2>

                {/* Persona Recommendation */}
                <div className="flex flex-col gap-2 bg-white/[0.03] border border-white/5 rounded-2xl p-4">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-[#9D7CFF] flex items-center gap-1">
                    <Bot size={11} /> Avatar Recomendado
                  </span>
                  <div className="text-xs text-white/80 leading-relaxed">
                    {plan.avatarRecommendation.rationale}
                  </div>
                </div>

                {/* Audience Target */}
                <div className="flex flex-col gap-3">
                  <div className="flex flex-col gap-0.5">
                    <span className="text-[10px] uppercase font-bold text-white/45">Perfil do Público</span>
                    <span className="text-xs font-semibold text-white/90">{plan.targetAudience.demographic}</span>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase font-bold text-white/45">Dores Principais</span>
                    <ul className="list-inside list-disc text-xs text-white/70 space-y-0.5">
                      {plan.targetAudience.painPoints.map((pain, i) => (
                        <li key={i}>{pain}</li>
                      ))}
                    </ul>
                  </div>

                  <div className="flex flex-col gap-1">
                    <span className="text-[10px] uppercase font-bold text-white/45">Desejos de Consumo</span>
                    <ul className="list-inside list-disc text-xs text-white/70 space-y-0.5">
                      {plan.targetAudience.desires.map((desire, i) => (
                        <li key={i}>{desire}</li>
                      ))}
                    </ul>
                  </div>
                </div>

                {/* Value Prop */}
                <div className="flex flex-col gap-1 border-t border-white/5 pt-3">
                  <span className="text-[10px] uppercase font-bold text-white/45">Proposta de Valor</span>
                  <p className="text-xs text-white/80 leading-relaxed font-semibold">{plan.valueProposition}</p>
                </div>
              </div>

              {/* Right Column: Creative recommendations & execution (8 cols) */}
              <div className="lg:col-span-8 flex flex-col gap-4">
                {/* Tabs */}
                <div className="flex border-b border-white/10 gap-2">
                  {[
                    { id: "creatives", label: "Anúncios em Imagem", icon: <ImageIcon size={12} /> },
                    { id: "videos", label: "Vídeos de React", icon: <Film size={12} /> },
                    { id: "captions", label: "Fórmulas de Copy/Legenda", icon: <FileText size={12} /> },
                  ].map((tab) => (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as any)}
                      className="flex items-center gap-1.5 pb-2.5 px-1 text-xs font-semibold border-b-2 transition-colors cursor-pointer"
                      style={{
                        borderColor: activeTab === tab.id ? "#9D7CFF" : "transparent",
                        color: activeTab === tab.id ? "#ffffff" : "rgba(255,255,255,0.42)",
                      }}
                    >
                      {tab.icon}
                      <span>{tab.label}</span>
                    </button>
                  ))}
                </div>

                {/* Tab Contents */}
                <div className="min-h-[400px] flex flex-col gap-4">
                  {/* Creative Ads Tab */}
                  {activeTab === "creatives" && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      {plan.recommendedAdCreatives.map((concept, idx) => {
                        const jobKey = `ad-${idx}`;
                        const job = launchedJobs[jobKey];

                        return (
                          <div
                            key={idx}
                            className="rounded-3xl border border-white/10 bg-white/[0.02] p-4 flex flex-col justify-between gap-4"
                          >
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-bold uppercase tracking-wider text-[#9D7CFF] bg-[#9D7CFF]/10 px-2 py-0.5 rounded">
                                  {concept.conceptName}
                                </span>
                              </div>
                              <div className="text-xs font-semibold text-white/90">
                                Copy na Imagem: &ldquo;{concept.copyText}&rdquo;
                              </div>
                              <p className="text-[11px] text-white/60 leading-relaxed">
                                {concept.explanation}
                              </p>
                              <div className="rounded-xl bg-black/40 border border-white/5 p-2 text-[10px] font-mono text-white/50 leading-relaxed">
                                <strong className="text-white/70 block mb-0.5">Prompt Visual (ImageFX):</strong>
                                {concept.visualPrompt}
                              </div>
                            </div>

                            {/* Job Launcher Panel */}
                            <div className="flex flex-col gap-2 pt-2 border-t border-white/5">
                              {!job && (
                                <button
                                  onClick={() => handleLaunchAdCreative(concept, idx)}
                                  className="w-full flex items-center justify-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-xs font-semibold text-white hover:bg-[#9D7CFF] hover:text-black transition-all cursor-pointer"
                                >
                                  <Zap size={11} />
                                  <span>Gerar com MrChicken</span>
                                </button>
                              )}

                              {job && job.status === "running" && (
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="text-[#9D7CFF] flex items-center gap-1.5">
                                      <Loader2 size={11} className="animate-spin" /> Processando no Piloto...
                                    </span>
                                  </div>
                                  {/* Micro Terminal for logs */}
                                  <div className="h-16 overflow-y-auto rounded-lg bg-black p-2 font-mono text-[9px] text-[#4ADE80] border border-white/5 leading-normal">
                                    {job.logs.map((log, lIdx) => (
                                      <div key={lIdx}>{log}</div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {job && job.status === "completed" && (
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center gap-1.5 text-xs text-green-400 font-semibold">
                                    <CheckCircle size={12} />
                                    <span>Geração Concluída!</span>
                                  </div>
                                  
                                  {job.resultPaths && job.resultPaths.length > 0 ? (
                                    <div className="grid grid-cols-2 gap-2 mt-1">
                                      {job.resultPaths.slice(0, 4).map((path, pIdx) => (
                                        <div key={pIdx} className="relative group rounded-xl overflow-hidden border border-white/10 bg-black">
                                          <img src={path} alt="Generated Ad Creative" className="w-full aspect-square object-cover" />
                                          <a
                                            href={path}
                                            download
                                            className="absolute bottom-2 right-2 p-1.5 rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                            title="Baixar imagem"
                                          >
                                            <Download size={10} />
                                          </a>
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    job.resultPath && (
                                      <a
                                        href={job.resultPath}
                                        download
                                        className="flex items-center justify-center gap-1.5 rounded-xl bg-green-500/10 border border-green-500/20 px-3 py-2 text-xs font-semibold text-green-400 hover:bg-green-500/20"
                                      >
                                        <Download size={11} />
                                        <span>Baixar Resultado</span>
                                      </a>
                                    )
                                  )}
                                </div>
                              )}

                              {job && job.status === "failed" && (
                                <div className="flex flex-col gap-1 text-[11px] text-red-400">
                                  <div className="flex items-center gap-1 font-semibold">
                                    <AlertCircle size={12} />
                                    <span>Falha ao gerar criativo.</span>
                                  </div>
                                  <span className="text-white/40 block overflow-hidden text-ellipsis whitespace-nowrap">{job.error}</span>
                                  <button
                                    onClick={() => handleLaunchAdCreative(concept, idx)}
                                    className="mt-1 w-full rounded-lg bg-white/5 border border-white/10 py-1.5 hover:bg-white/10 text-xs cursor-pointer"
                                  >
                                    Tentar Novamente
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* React Videos Tab */}
                  {activeTab === "videos" && (
                    <div className="flex flex-col gap-4">
                      {plan.recommendedReactVideos.map((video, idx) => {
                        const jobKey = `video-${idx}`;
                        const job = launchedJobs[jobKey];

                        return (
                          <div
                            key={idx}
                            className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 flex flex-col gap-4"
                          >
                            <div className="flex flex-col gap-1.5">
                              <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-white">{video.title}</h3>
                                <span className="text-[9px] font-bold uppercase tracking-wider text-[#9D7CFF] bg-[#9D7CFF]/10 px-2 py-0.5 rounded">
                                  React Video
                                </span>
                              </div>
                              <p className="text-xs text-white/50 italic leading-relaxed">
                                &ldquo;{video.explanation}&rdquo;
                              </p>

                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-2">
                                <div className="flex flex-col gap-1">
                                  <span className="text-[10px] uppercase font-bold text-white/45">Gancho (0-3s)</span>
                                  <p className="text-xs text-[#9D7CFF] font-semibold">{video.hook}</p>
                                </div>
                                <div className="flex flex-col gap-1">
                                  <span className="text-[10px] uppercase font-bold text-white/45">Vídeo de Origem (Pesquisa)</span>
                                  <p className="text-xs text-white/80">{video.topic}</p>
                                </div>
                              </div>

                              <div className="mt-2 rounded-xl bg-white/[0.02] border border-white/5 p-4">
                                <span className="text-[10px] uppercase font-bold text-white/45 block mb-1">Roteiro Sugerido (Voz do Avatar)</span>
                                <p className="text-xs text-white/85 leading-relaxed italic">
                                  &ldquo;{video.voiceoverScript}&rdquo;
                                </p>
                              </div>
                            </div>

                            {/* Job Launcher Panel */}
                            <div className="pt-3 border-t border-white/5 flex flex-col gap-2">
                              {!job && (
                                <button
                                  onClick={() => handleLaunchReactVideo(video, idx)}
                                  className="w-full md:w-auto self-start flex items-center justify-center gap-1.5 rounded-xl bg-white/10 px-4 py-2 text-xs font-semibold text-white hover:bg-[#9D7CFF] hover:text-black transition-all cursor-pointer"
                                >
                                  <Zap size={11} />
                                  <span>Gerar React Video</span>
                                </button>
                              )}

                              {job && job.status === "running" && (
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center justify-between text-[11px]">
                                    <span className="text-[#9D7CFF] flex items-center gap-1.5">
                                      <Loader2 size={11} className="animate-spin" /> Renderizando Pipeline no Piloto...
                                    </span>
                                  </div>
                                  {/* Micro Terminal for logs */}
                                  <div className="h-20 overflow-y-auto rounded-lg bg-black p-2.5 font-mono text-[9px] text-[#4ADE80] border border-white/5 leading-normal">
                                    {job.logs.map((log, lIdx) => (
                                      <div key={lIdx}>{log}</div>
                                    ))}
                                  </div>
                                </div>
                              )}

                              {job && job.status === "completed" && (
                                <div className="flex flex-col gap-2">
                                  <div className="flex items-center gap-1.5 text-xs text-green-400 font-semibold">
                                    <CheckCircle size={12} />
                                    <span>Vídeo Gerado com Sucesso!</span>
                                  </div>
                                  {job.resultPath && (
                                    <div className="flex gap-2">
                                      <a
                                        href={job.resultPath}
                                        download
                                        className="flex items-center justify-center gap-1.5 rounded-xl bg-green-500/10 border border-green-500/20 px-4 py-2 text-xs font-semibold text-green-400 hover:bg-green-500/20"
                                      >
                                        <Download size={11} />
                                        <span>Baixar Vídeo Final (React)</span>
                                      </a>
                                    </div>
                                  )}
                                </div>
                              )}

                              {job && job.status === "failed" && (
                                <div className="flex flex-col gap-1 text-[11px] text-red-400">
                                  <div className="flex items-center gap-1 font-semibold">
                                    <AlertCircle size={12} />
                                    <span>Erro no Pipeline de Geração.</span>
                                  </div>
                                  <span className="text-white/40 block overflow-hidden text-ellipsis whitespace-nowrap">{job.error}</span>
                                  <button
                                    onClick={() => handleLaunchReactVideo(video, idx)}
                                    className="mt-1 w-full md:w-auto self-start rounded-lg bg-white/5 border border-white/10 px-4 py-1.5 hover:bg-white/10 text-xs cursor-pointer"
                                  >
                                    Reiniciar Geração
                                  </button>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Copy Captions Tab */}
                  {activeTab === "captions" && (
                    <div className="flex flex-col gap-4">
                      {plan.socialCaptions.map((caption, idx) => (
                        <div
                          key={idx}
                          className="rounded-3xl border border-white/10 bg-white/[0.02] p-5 flex flex-col gap-3"
                        >
                          <div className="flex items-center justify-between border-b border-white/5 pb-2">
                            <span className="text-xs font-semibold text-white/90">
                              Sugestão de Legenda ({caption.platform})
                            </span>
                            <button
                              onClick={() => copyToClipboard(caption.captionText, idx)}
                              className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[10px] text-white/60 hover:bg-white/10 transition-colors cursor-pointer"
                            >
                              <Copy size={10} />
                              <span>{copiedIndex === idx ? "Copiado!" : "Copiar"}</span>
                            </button>
                          </div>
                          <p className="text-xs text-white/80 leading-relaxed whitespace-pre-line font-mono bg-black/20 p-3 rounded-xl border border-white/5">
                            {caption.captionText}
                          </p>
                          <div className="text-[11px] text-white/50 leading-relaxed">
                            <strong className="text-white/70">CTA:</strong> {caption.callToAction}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
