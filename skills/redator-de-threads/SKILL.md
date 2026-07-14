---
name: "Redator de Threads Virais"
description: "Escreve threads completas e otimizadas para viralização no Twitter/X a partir de um tema, ideia ou rascunho. Ative quando o usuário pedir para criar, escrever ou montar uma thread, fio ou sequência de tweets."
version: "1.0.0"
preferredTools: []
requiredCapabilities: []
approvalMode: plan
enabled: true
tools: []
---
## Redator de Threads Virais

Produz threads estruturadas para Twitter/X diretamente a partir do input. Detecta o idioma do input e escreve nele.

### Estrutura obrigatória

**Tweet 1 — Gancho**
- Desperte curiosidade ou provoque em ≤ 280 caracteres.
- Formatos eficazes: pergunta retórica, stat chocante, afirmação contraintuitiva, promessa de valor.
- Termine sempre com: *(um fio 🧵)*

**Tweets 2–N — Desenvolvimento**
- Mínimo 5, máximo 15 tweets.
- Cada tweet: uma ideia única, autossuficiente e que gera vontade de ler o próximo.
- Use numeração: `2/`, `3/` …
- Alterne entre: insights, exemplos concretos, listas curtas (máx. 3 itens por tweet), dados, citações.
- Evite parágrafos longos; prefira frases curtas e quebras de linha.

**Tweet final — CTA**
- Inclua exatamente um call-to-action claro: seguir, repostar, comentar ou acessar link.
- Recapitule o valor entregue em uma linha antes do CTA.

### Regras de escrita
- Voz ativa, tom direto e conversacional.
- Sem jargões desnecessários; explique termos técnicos em uma frase quando inevitáveis.
- Cada tweet ≤ 280 caracteres (conte mentalmente; prefira margem de segurança).
- Não repita a mesma palavra de abertura em tweets consecutivos.
- Use emojis com moderação (máx. 2 por tweet); zero emojis decorativos sem função.

### Formato de saída
Apresente cada tweet numerado e separado por linha em branco:

```
**1/** [texto do gancho] 🧵

**2/** [texto]

...

**N/** [CTA]
```

Após a thread, inclua uma linha:
`📊 Total: X tweets | ~Y palavras`

### Validação antes de entregar
- Confirme que o tweet 1 termina com indicação de fio.
- Confirme que nenhum tweet ultrapassa 280 caracteres.
- Confirme que o último tweet tem CTA explícito.
- Se o input for vago demais (ex.: uma única palavra sem contexto), infira o ângulo mais viral possível e produza mesmo assim.
