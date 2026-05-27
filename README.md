# AI UGC Reaction Studio

SaaS para criar videos verticais de react com IA usando Next.js App Router, TypeScript e Supabase.

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
