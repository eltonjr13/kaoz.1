# Guia de Estilos, Psicologia de Cores e Vetorização de Logotipos

Este documento serve como referência de conhecimento profundo para o design de logotipos profissionais através de inteligência artificial generativa.

## 1. Guia de Estilos e Termos de Prompt (IA)

A tabela abaixo define os termos técnicos em inglês que devem ser adicionados aos prompts para garantir a consistência de cada estilo visual:

| Estilo | Descrição | Termos Positivos Recomendados | Evitar (Termos Negativos) |
|---|---|---|---|
| **Minimalista** | Reduzido aos elementos essenciais para máxima clareza. | `minimalist vector logo, flat design, clean lines, simple graphic element, solid colors` | `3d, gradients, shadows, complex details, photorealistic` |
| **Moderno** | Estilo contemporâneo e inovador, ideal para startups. | `modern sleek vector logo, contemporary design, professional, clean layout, futuristic touch` | `vintage, retro, grunge, classic elements` |
| **Retro / Vintage** | Visual clássico e nostálgico, frequentemente em formato de selo ou emblema. | `vintage retro badge logo, classic emblem, distressed textured style, 1970s aesthetic, stamp style` | `futuristic, ultra-modern, neon, glossy finish` |
| **Geométrico** | Formas e padrões baseados em geometria exata e simetria. | `geometric vector logo, abstract shape, perfect geometry, symmetry, clean minimalist design` | `organic shapes, hand-drawn style, chaotic elements` |
| **Emblema / Crest** | Estruturas tradicionais semelhantes a brasões e selos de qualidade. | `circular crest emblem logo, traditional shield badge, heraldic seal, detailed vector art, border frames` | `minimal icon, abstract shape, ultra-simple` |
| **Mascote** | Personagens caricatos ou ilustrados que representam a marca. | `mascot character vector logo, friendly character design, clean outlines, iconic illustration, cartoon style` | `serious corporate look, abstract geometry, photo-realism` |
| **Line-art** | Arte linear, onde o logotipo é formado por linhas contínuas e fluidas. | `minimalist line art logo, continuous line vector drawing, elegant clean lines, simple aesthetic` | `bold filled shapes, complex gradients, multi-color patterns` |

---

## 2. Psicologia das Cores para Branding

As cores transmitem emoções e sentimentos de forma subconsciente. Escolha a paleta de cores correta baseando-se no sentimento da marca:

- **Azul**: Confiança, profissionalismo, segurança, estabilidade. Muito usado em tecnologia, finanças, saúde e advocacia.
  *Paletas sugeridas no prompt:* `navy blue and white` ou `royal blue and cool gray`.
- **Verde**: Natureza, crescimento, saúde, sustentabilidade, frescor. Ideal para produtos orgânicos, ecologia, agronegócio e bem-estar.
  *Paletas sugeridas no prompt:* `forest green and sage green` ou `emerald green and white`.
- **Vermelho**: Energia, paixão, urgência, apetite, poder. Comum em alimentação, entretenimento, esportes e varejo.
  *Paletas sugeridas no prompt:* `crimson red and charcoal gray` ou `scarlet red and white`.
- **Amarelo / Laranja**: Otimismo, criatividade, energia, calor, diversão. Recomendado para marcas infantis, criativas, culinária rápida e tecnologia inovadora.
  *Paletas sugeridas no prompt:* `mustard yellow and black` ou `orange and dark gray`.
- **Roxo / Rosa**: Luxo, sofisticação, criatividade, feminilidade, mistério. Adequado para cosméticos, produtos premium, espiritualidade e docerias.
  *Paletas sugeridas no prompt:* `deep purple and gold` ou `rose pink and soft cream`.
- **Preto / Branco / Cinza**: Minimalismo, elegância, autoridade, luxo clássico, neutralidade. Perfeito para marcas de alta moda, arquitetura, design e serviços corporativos premium.
  *Paletas sugeridas no prompt:* `monochrome, black and white` ou `charcoal black and metallic silver`.

---

## 3. Guia de Vetorização de Logotipos (Entregável ao Usuário)

Como as imagens geradas por IA são entregues em formato rasterizado (PNG/JPEG), elas pixelizam ao serem ampliadas. Para usar o logotipo profissionalmente em fachadas, cartões, camisas ou impressões em grande escala, o usuário precisa **vetorizar** o logotipo.

Instrua o cliente com o seguinte passo a passo gratuito:

### Método 1: Vetorização Automática com Ferramentas Online Gratuitas
1. Acesse o site gratuito **Vectorizer.ai** ou **svgcreator.com**.
2. Faça o upload da imagem do logotipo gerada pela IA (com fundo branco).
3. A ferramenta converterá a imagem automaticamente em traços vetoriais.
4. Faça o download no formato **SVG** ou **EPS**.

### Método 2: Vetorização Manual e Gratuita no Inkscape (Software Livre)
1. Faça o download gratuito do software **Inkscape** (inkscape.org).
2. Abra a imagem do logotipo no Inkscape.
3. Selecione a imagem com o cursor.
4. Vá no menu superior em: **Caminho** -> **Rastrear Bitmap** (Path -> Trace Bitmap).
5. Ajuste o limiar de brilho (Threshold) e clique em **Aplicar**. O Inkscape criará uma camada vetorial por cima do logotipo original.
6. Delete a imagem original de fundo e salve o arquivo como **SVG do Inkscape** ou **SVG Limpo**.

---

## 4. Estrutura Padrão de Prompt Eficiente
Para obter os melhores resultados possíveis no Flow do Google, a estrutura do prompt gerado deve seguir esta lógica:

`[Estilo Principal/Keywords Técnicas] + for a [Nicho] business + named "[Nome da Marca]" (se houver) + [Elementos Visuais Incorporados] + Color palette: [Cores] + [Keywords de Isolamento de Fundo e Qualidade Técnica]`

### Palavras de Isolamento Essenciais:
Para garantir que o logo não seja gerado como um mockup de camiseta, boné ou em cima de uma mesa:
- `isolated on a clean white background`
- `solid flat vector illustration`
- `high contrast`
- `no photorealism, no 3D render, no shadows, no gradients` (se o estilo exigir imagem 2D puramente plana).