import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  BrainCircuit,
  Clapperboard,
  Network,
  Play,
  Sparkles,
} from "lucide-react";

const capabilities = [
  {
    index: "01",
    icon: BrainCircuit,
    title: "Pensar com contexto",
    description: "Córtex, memória e agentes trabalhando sobre o mesmo objetivo.",
  },
  {
    index: "02",
    icon: Network,
    title: "Orquestrar o trabalho",
    description: "Do primeiro comando à execução, com decisões visíveis no Flow.",
  },
  {
    index: "03",
    icon: Clapperboard,
    title: "Transformar em entrega",
    description: "Pesquisa, roteiro, voz e vídeo reunidos em uma produção revisável.",
  },
];

export default function HomePage() {
  return (
    <main className="home-entry">
      <header className="home-entry__header">
        <Link className="home-entry__brand" href="/" aria-label="Kaoz.1 — início">
          <span className="home-entry__brand-mark">
            <Play size={13} fill="currentColor" />
          </span>
          <span>Kaoz.1</span>
        </Link>

        <span className="home-entry__edition">Creative Intelligence / 01</span>
      </header>

      <section className="home-entry__hero">
        <div className="home-entry__copy">
          <div className="home-entry__eyebrow">
            <span className="home-entry__signal" aria-hidden="true" />
            Sistema criativo em operação
          </div>

          <h1>
            Tire ideias do caos.
            <span>Coloque-as em movimento.</span>
          </h1>

          <p className="home-entry__lead">
            Um workspace de inteligência criativa para pensar, coordenar agentes e transformar
            intenção em produção real — sem perder o controle do processo.
          </p>

          <div className="home-entry__actions">
            <Link className="home-entry__primary kaoz-signal-action" href="/flow">
              Abrir workspace <ArrowRight size={17} />
            </Link>
            <Link className="home-entry__secondary" href="/video">
              Ir para o estúdio <ArrowUpRight size={16} />
            </Link>
          </div>

          <div className="home-entry__meta" aria-label="Recursos disponíveis">
            <span>Córtex cognitivo</span>
            <span>Agentes conectados</span>
            <span>Produção local</span>
          </div>
        </div>

        <div className="home-entry__system" aria-label="Capacidades do Kaoz.1">
          <div className="home-entry__system-head">
            <div>
              <span className="home-entry__system-kicker">Kaoz Signal</span>
              <h2>Da intenção à entrega.</h2>
            </div>
            <Sparkles size={18} aria-hidden="true" />
          </div>

          <div className="home-entry__capabilities">
            {capabilities.map((capability) => {
              const Icon = capability.icon;

              return (
                <div className="home-entry__capability" key={capability.index}>
                  <span className="home-entry__capability-index">{capability.index}</span>
                  <span className="home-entry__capability-icon" aria-hidden="true">
                    <Icon size={18} strokeWidth={1.7} />
                  </span>
                  <div>
                    <h3>{capability.title}</h3>
                    <p>{capability.description}</p>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="home-entry__system-foot">
            <span>Contexto</span>
            <i aria-hidden="true" />
            <span>Coordenação</span>
            <i aria-hidden="true" />
            <span>Criação</span>
          </div>
        </div>
      </section>

      <footer className="home-entry__footer">
        <span>Kaoz.1 / Ambiente de criação assistida</span>
        <span>Build local · dados sob seu controle</span>
      </footer>
    </main>
  );
}
