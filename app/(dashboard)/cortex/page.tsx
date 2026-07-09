import { CortexGraphClient } from "@/components/cortex/cortex-graph-client";
import { CortexChatMemories } from "@/components/cortex/cortex-chat-memories";

export const dynamic = "force-dynamic";

export default function CortexPage() {
  return (
    <>
      <div className="title-row" style={{ marginBottom: "20px" }}>
        <div className="section-title">
          <h1>Córtex Cognitivo</h1>
          <p>Visualização em tempo real do Grafo de Conhecimento e do aprendizado contínuo do Agente.</p>
        </div>
      </div>
      <CortexGraphClient />
      <CortexChatMemories />
    </>
  );
}
