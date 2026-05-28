# AI UGC Reaction Studio

SaaS em Next.js App Router para criar videos verticais de react com IA. O foco atual e transformar uma referencia viral em um job com avatar autorizado, roteiro curto, voz gerada, composicao vertical e arquivo final para revisao/download.

## Estado atual do projeto

O app ja possui uma experiencia funcional sem login. A rota `/login` redireciona para `/dashboard`, e as telas usam um workspace fixo definido por `APP_WORKSPACE_ID`.

Funcionalidades implementadas:

- Landing page em `/` com entrada para dashboard e busca viral.
- Dashboard em `/dashboard` com resumo de avatares, jobs recentes e videos finalizados.
- Cadastro de avatares em `/avatars`, com consentimento obrigatorio e upload de imagem/video, alem de audio de referencia opcional.
- Busca viral em `/viral-search`, gerando oportunidades por nicho para TikTok, Instagram e YouTube.
- Criacao de jobs em `/jobs/new`, incluindo assunto, avatar e link de video fonte para colagem.
- Listagem de jobs em `/jobs`, com status, fonte usada e download quando houver render final.
- APIs internas para avatares, jobs, busca viral e inicio do pipeline.
- Persistencia em Supabase quando configurado, com fallback local em `.generated/local-data`.
- Render local do video final via `ffmpeg`, com layout vertical: expert no topo e video fonte embaixo.

Pontos ainda parciais ou dependentes de servico externo:

- A busca viral nao consome APIs externas; ela gera buscas, hooks e formatos a partir de padroes locais.
- O lip-sync ainda nao chama uma ferramenta real. O modulo atual retorna o avatar original para o render.
- A voz depende de uma instancia OmniVoice/Gradio acessivel por `OMNIVOICE_API_URL`.
- O download de Instagram/YouTube para render depende de `yt-dlp`.
- A geracao de roteiro usa OpenAI quando `OPENAI_API_KEY` existe; sem chave, usa um texto fallback.

## Stack

- Next.js 16 App Router
- React 19
- TypeScript
- Supabase SSR e Supabase JS
- OpenAI para roteiro
- Gradio client para OmniVoice
- ffmpeg/ffprobe para render
- yt-dlp para baixar videos fonte remotos

## Estrutura principal

```text
app/
  api/
    avatars/route.ts          API de listagem/criacao de avatares
    jobs/route.ts             API de listagem/criacao de jobs
    pipeline/start/route.ts   Inicio e execucao local do pipeline
    viral-search/route.ts     API da busca viral local
  (dashboard)/                Telas autenticadas na pratica, mas sem login ativo
components/                   UI, forms, tabelas e layout
lib/
  ai/                         Roteiro OpenAI e voz OmniVoice
  videos/                     Busca viral, parser de fonte, pipeline e render
  local-store.ts              Fallback local em JSON e uploads publicos
  supabase/                   Cliente Supabase server-side
supabase/schema.sql           Schema, RLS permissivo para workspace unico e buckets
types/                        Tipos de dominio
```

## Configuracao

1. Instale as dependencias:

```bash
npm install
```

2. Copie o arquivo de ambiente:

```bash
copy .env.example .env.local
```

3. Configure as variaveis em `.env.local`:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
APP_WORKSPACE_ID=00000000-0000-4000-8000-000000000001

OPENAI_API_KEY=
OMNIVOICE_API_KEY=
OMNIVOICE_API_URL=http://localhost:8000
LIPSYNC_API_KEY=
```

As chaves de provedores de IA devem ficar apenas no servidor e nunca usar prefixo `NEXT_PUBLIC_`.

4. Se for usar Supabase, rode `supabase/schema.sql` no projeto Supabase. O schema cria tabelas, enums, triggers, politicas RLS permissivas para o modo workspace unico e buckets `avatars`, `job-assets` e `renders`.

5. Para render local completo, deixe estes comandos disponiveis no worker:

- `ffmpeg`
- `ffprobe`
- `yt-dlp`, ou Python com modulo `yt_dlp`

Tambem e possivel configurar caminhos explicitos:

```env
FFMPEG_PATH=
FFPROBE_PATH=
YTDLP_PATH=
```

## Rodando

```bash
npm run dev
```

Depois abra:

- `http://localhost:3000` para a landing page.
- `http://localhost:3000/dashboard` para a area principal.
- `http://localhost:3000/viral-search` para comecar pela pesquisa de oportunidades.

## Scripts

```bash
npm run dev        # servidor de desenvolvimento
npm run build      # build de producao
npm run start      # servidor de producao apos build
npm run lint       # ESLint sem warnings
npm run typecheck  # TypeScript sem emitir arquivos
```

## Fluxo de uso

1. Cadastre um avatar em `/avatars` e aceite o consentimento.
2. Use `/viral-search` para gerar ideias, hooks e links de busca por nicho.
3. Crie um job em `/jobs/new`, escolhendo avatar, assunto e opcionalmente um link de video fonte.
4. O app inicia o pipeline:
   - gera roteiro;
   - gera voz via OmniVoice;
   - prepara o avatar para lip-sync, hoje ainda como placeholder;
   - baixa/prepara o video fonte quando informado;
   - renderiza o video vertical final.
5. Acompanhe o status e baixe o resultado em `/jobs`.

## Persistencia

Quando Supabase esta configurado, o app grava avatares, jobs, eventos e arquivos nos buckets configurados.

Quando Supabase nao esta configurado ou uma operacao falha, o app usa fallback local:

- Metadados: `.generated/local-data/*.json`
- Avatares: `public/uploads/avatars`
- Audios: `public/uploads/audio`
- Renders locais: `public/uploads/renders`
- Arquivos temporarios de job: `.generated/jobs`

## Observacoes tecnicas

- O projeto esta em modo workspace unico, nao em multiusuario real.
- As politicas RLS do schema estao abertas para `anon` e `authenticated` dentro do desenho atual.
- O middleware apenas desativa a tela de login redirecionando `/login` para `/dashboard`.
- Para producao, antes de expor publicamente, e necessario revisar autenticacao, isolamento por usuario/workspace, politicas RLS e armazenamento de arquivos.
