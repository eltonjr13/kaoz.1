---
name: eslint-cyclomatic-complexity
description: Configura a regra de Cyclomatic Complexity no ESLint de projetos JavaScript/TypeScript. Use esta skill sempre que for solicitado configurar complexidade ciclomática, qualidade de código via ESLint, ou ao criar/modificar projetos que usem ESLint.
---

# ESLint Cyclomatic Complexity Rule

## Objetivo

Adicionar **somente** a regra `complexity` ao ESLint existente no projeto, com limite máximo de complexidade ciclomática igual a **10**.

## Regras Obrigatórias

1. **Adicionar APENAS a regra `complexity`** — nenhuma outra regra deve ser adicionada.
2. **Limite máximo: 10** — funções com complexidade ciclomática acima de 10 devem gerar erro.
3. **Não alterar código de negócio** — apenas a configuração do ESLint deve ser modificada.
4. **Não instalar dependências desnecessárias** — a regra `complexity` é nativa do ESLint, não requer plugins adicionais.
5. **Ao final, mostrar a alteração feita** — exiba o trecho de configuração modificado para o usuário.

## Como Aplicar

### Passo 1: Identificar o arquivo de configuração do ESLint

Procure por um destes arquivos na raiz do projeto (em ordem de prioridade):
- `eslint.config.js` ou `eslint.config.mjs` (flat config — ESLint 9+)
- `.eslintrc.js`, `.eslintrc.cjs`, `.eslintrc.mjs`
- `.eslintrc.json`
- `.eslintrc.yaml` ou `.eslintrc.yml`
- Seção `eslintConfig` dentro do `package.json`

### Passo 2: Adicionar a regra `complexity`

#### Para Flat Config (`eslint.config.js` / `eslint.config.mjs`):

```javascript
// Adicionar dentro do objeto de regras existente:
export default [
  // ... configurações existentes ...
  {
    rules: {
      // ... regras existentes (manter todas) ...
      "complexity": ["error", 10]
    }
  }
];
```

Se já existir um objeto com `rules`, adicione `"complexity": ["error", 10]` dentro dele. **Não crie um novo objeto** se já houver um adequado.

#### Para Legacy Config (`.eslintrc.*`):

```json
{
  "rules": {
    "complexity": ["error", 10]
  }
}
```

#### Para `package.json`:

```json
{
  "eslintConfig": {
    "rules": {
      "complexity": ["error", 10]
    }
  }
}
```

### Passo 3: Verificar

Após a alteração, execute:
```bash
npx eslint . --max-warnings=0
```

Para verificar se a regra está ativa e se alguma função excede o limite.

### Passo 4: Mostrar ao usuário

Sempre mostre ao usuário o trecho exato da configuração que foi alterado, usando um bloco diff:

```diff
 rules: {
   // regras existentes...
+  "complexity": ["error", 10]
 }
```

## Referência

| Propriedade | Valor |
|-------------|-------|
| Regra ESLint | `complexity` |
| Severidade | `error` |
| Limite máximo | `10` |
| Requer plugin | Não (regra nativa) |
| Docs oficiais | https://eslint.org/docs/latest/rules/complexity |

## O que é Complexidade Ciclomática?

A complexidade ciclomática mede o número de caminhos linearmente independentes através do código de uma função. Cada `if`, `else`, `case`, `for`, `while`, `&&`, `||`, `?:` e `catch` incrementa a complexidade em 1.

- **1-10**: Código simples, baixo risco ✅
- **11-20**: Moderadamente complexo ⚠️
- **21+**: Alto risco, difícil de testar e manter ❌
