// validar-versao.ts
// Valida formato de versão semântica (ex.: v0.2.11, v1.0.0, v2.3.4-alpha)
// Uso: node validar-versao.ts '{"versao":"v0.2.11"}'

const args = process.argv[2];
if (!args) {
  console.error(JSON.stringify({ error: "Nenhum argumento fornecido. Use JSON no primeiro argumento." }));
  process.exit(1);
}

let input: { versao?: string };
try {
  input = JSON.parse(args);
} catch {
  console.error(JSON.stringify({ error: "Argumento inválido: não é um JSON válido." }));
  process.exit(1);
}

const versao = input.versao;
if (!versao || typeof versao !== 'string') {
  console.error(JSON.stringify({ error: "Campo 'versao' é obrigatório e deve ser uma string." }));
  process.exit(1);
}

// Regex: v seguido de número(s).número(s).número(s), opcionalmente com sufixo
const regex = /^v\d+\.\d+\.\d+(-[a-zA-Z0-9]+)?$/;
if (!regex.test(versao.trim())) {
  console.error(JSON.stringify({ error: `Formato de versão inválido: "${versao}". Use o formato v0.0.0 (ex.: v0.2.11).` }));
  process.exit(1);
}

const resultado = {
  valido: true,
  versao: versao.trim(),
  normalizada: versao.trim().toLowerCase()
};

console.log(JSON.stringify(resultado));