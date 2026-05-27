import Link from "next/link";
import { ArrowRight, Bot, Clapperboard, Mic2, Play, Search, Sparkles } from "lucide-react";

export default function HomePage() {
  return (
    <main className="page-shell">
      <header className="topbar">
        <Link className="brand" href="/">
          <span className="brand-mark">
            <Play size={18} fill="currentColor" />
          </span>
          <span>AI UGC Reaction Studio</span>
        </Link>
        <Link className="button secondary" href="/viral-search">
          Busca viral
        </Link>
      </header>

      <section className="hero">
        <div className="hero-grid">
          <div className="hero-copy">
            <p className="eyebrow">React videos com avatar autorizado</p>
            <h1>AI UGC Reaction Studio</h1>
            <p>
              Crie jobs de react vertical com avatar real autorizado, roteiro curto, voz OmniVoice,
              lip-sync e render final pronto para revisao e download. Agora o foco esta na pesquisa
              de videos virais por nicho para TikTok e Instagram.
            </p>
            <div className="hero-actions">
              <Link className="button" href="/viral-search">
                Buscar virais <Search size={18} />
              </Link>
              <Link className="button secondary" href="/dashboard">
                Abrir dashboard <ArrowRight size={18} />
              </Link>
            </div>
          </div>

          <div className="product-frame studio-preview" aria-label="Preview do studio">
            <div className="phone-preview">
              <div className="phone-screen">
                <div className="caption-strip">Esse trend virou oportunidade.</div>
                <div className="avatar-bubble">AI</div>
              </div>
            </div>
            <div className="pipeline-preview">
              <div className="pipeline-step">
                <span className="icon-tile">
                  <Bot size={20} />
                </span>
                <div>
                  <strong>Pesquisa viral</strong>
                  <span>Topicos e referencias entram no job.</span>
                </div>
                <span className="status-badge queued">fila</span>
              </div>
              <div className="pipeline-step">
                <span className="icon-tile">
                  <Sparkles size={20} />
                </span>
                <div>
                  <strong>Roteiro IA</strong>
                  <span>Texto curto para react de alto ritmo.</span>
                </div>
                <span className="status-badge scripting">script</span>
              </div>
              <div className="pipeline-step">
                <span className="icon-tile">
                  <Mic2 size={20} />
                </span>
                <div>
                  <strong>Voz e lip-sync</strong>
                  <span>OmniVoice mais avatar autorizado.</span>
                </div>
                <span className="status-badge rendering">render</span>
              </div>
              <div className="pipeline-step">
                <span className="icon-tile">
                  <Clapperboard size={20} />
                </span>
                <div>
                  <strong>Video vertical</strong>
                  <span>Arquivo final para revisao.</span>
                </div>
                <span className="status-badge completed">final</span>
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
