import * as fs from "fs";
import * as path from "path";
import { flowAgent } from "../src/providers/flow/FlowAgent";
import { flowProvider } from "../src/providers/flow/FlowProvider";
import { createLocalJob, listLocalAvatars, findLocalJob } from "../lib/local-store";

// Simple helper to load .env.local variables manually
function loadEnvLocal() {
  const envPath = path.resolve(".env.local");
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, "utf8");
    const lines = content.split(/\r?\n/);
    for (const line of lines) {
      const match = line.match(/^\s*([\w.-]+)\s*=\s*(.*)$/);
      if (match) {
        const key = match[1];
        let val = match[2].trim();
        if (val.startsWith('"') && val.endsWith('"')) {
          val = val.slice(1, -1);
        } else if (val.startsWith("'") && val.endsWith("'")) {
          val = val.slice(1, -1);
        }
        process.env[key] = val;
      }
    }
  }
}

async function testExecution() {
  console.log("Loading .env.local variables...");
  loadEnvLocal();

  // Mock flowProvider.generateImage
  flowProvider.generateImage = async (prompt: string, options?: any) => {
    console.log(`\n[MOCK] generateImage chamado para o prompt:\n  "${prompt}"\n  Opções:`, options);
    return {
      success: true,
      path: "public/uploads/images/mock-image.png",
      paths: [
        "public/uploads/images/mock-image-1.png",
        "public/uploads/images/mock-image-2.png",
        "public/uploads/images/mock-image-3.png",
        "public/uploads/images/mock-image-4.png",
      ],
      filename: "mock-image.png",
      filenames: ["mock-image-1.png", "mock-image-2.png", "mock-image-3.png", "mock-image-4.png"],
      createdAt: new Date().toISOString()
    };
  };

  // Get or create a dummy avatar to satisfy lookups
  const avatars = await listLocalAvatars();
  let avatarId = avatars[0]?.id;
  if (!avatarId) {
    console.log("Nenhum avatar encontrado. Criando avatar temporário de teste...");
    avatarId = "test-avatar-id";
    const dummyAvatar = {
      id: avatarId,
      name: "Avatar Teste",
      image_path: "/uploads/avatars/test.png",
      voice_settings: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };
    const DATA_DIR = path.join(process.cwd(), ".generated", "local-data");
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    await fs.promises.writeFile(path.join(DATA_DIR, "avatars.json"), JSON.stringify([dummyAvatar], null, 2), "utf8");
  }

  console.log(`Usando avatar ID: ${avatarId}`);

  // Create a new local job for testing
  const topic = "Criativos de imagem de café energético para programadores";
  const job = await createLocalJob({
    avatarId,
    topic,
    renderLayout: "balanced_split",
    expertBackgroundMode: "original"
  });

  console.log(`Criado ReactionJob local com ID: ${job.id}`);

  // Mock an approvedPlan decision of type 'ad-creative'
  const approvedPlan = {
    flow: "ad-creative" as const,
    explanation: "Fluxo planejado para anúncio em escala",
    optimizedPrompt: "Criar campanha de anúncios para suplemento de cafeína",
    targetJobId: null,
    requestedImageCount: 20,
    adCreativePlan: {
      concepts: [
        {
          conceptName: "Conceito 1: Bug-free Coffee",
          copyText: "TURN COFFEE INTO BUG-FREE CODE",
          visualPrompt: "A sleek workspace with a coffee cup, steam showing glowing green code, bold white text overlay reads 'TURN COFFEE INTO BUG-FREE CODE' on top."
        },
        {
          conceptName: "Conceito 2: Midnight Coding",
          copyText: "FUEL FOR MIDNIGHT CALLS",
          visualPrompt: "A developer room at night with neon lights, energy coffee drink, text overlay reads 'FUEL FOR MIDNIGHT CALLS'."
        }
      ]
    }
  };

  console.log("Iniciando a execução do fluxo autonomo do agente...");
  
  try {
    const result = await flowAgent.runAutonomousAgent({
      topic,
      avatarId,
      model: "gemini",
      jobId: job.id,
      approvedPlan
    });

    console.log("\nExecução do agente finalizada.");
    console.log("Resultado retornado pelo agente:", result);

    // Verify job in database
    const updatedJob = await findLocalJob(job.id);
    if (!updatedJob) {
      console.error("[FALHA] Job não foi encontrado no banco de dados local.");
      process.exit(1);
    }

    console.log("\n[VERIFICAÇÃO] Dados do Job atualizados no local-store:");
    console.log(`Status do Job: ${updatedJob.status}`);
    console.log(`Descrição do Vídeo (Mídia): ${updatedJob.source_video_description}`);
    
    const transcription = JSON.parse(updatedJob.source_video_transcription || "{}");
    console.log("Transcrição decodificada:", JSON.stringify(transcription, null, 2));

    if (
      updatedJob.status === "completed" &&
      transcription.mode === "ad-creative" &&
      transcription.concepts.length === 2 &&
      transcription.concepts[0].images.length === 4
    ) {
      console.log("\n[SUCESSO INTEGRAL] O fluxo 'ad-creative' executou e persistiu os dados com sucesso absoluto!");
    } else {
      console.error("\n[FALHA] Estrutura salva no banco de dados não corresponde ao esperado.");
    }
  } catch (err) {
    console.error("Erro na execução do agente:", err);
  }
}

testExecution();
