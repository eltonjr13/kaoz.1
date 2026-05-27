# AI UGC Reaction Studio

SaaS para criar videos verticais de react com IA usando Next.js App Router, TypeScript e Supabase.

Login esta desativado por enquanto. A area principal abre direto no dashboard e a funcionalidade prioritaria e a busca viral por nicho para Instagram e YouTube.

O job aceita um link de Instagram ou YouTube como video fonte. No render, o expert fica na parte superior do video vertical e a fonte escolhida entra colada na parte inferior, como react.

Para render local com download automatico de Instagram/YouTube, o worker precisa ter `ffmpeg` e `yt-dlp` no PATH ou configurar `FFMPEG_PATH` e `YTDLP_PATH`.

## Setup

1. Copie `.env.example` para `.env.local`.
2. Preencha `NEXT_PUBLIC_SUPABASE_URL` e `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
3. Rode o SQL em `supabase/schema.sql` no Supabase.
4. Instale e rode:

```bash
npm install
npm run dev
```

As chaves de provedores de IA devem ficar apenas no servidor e nunca usar prefixo `NEXT_PUBLIC_`.
