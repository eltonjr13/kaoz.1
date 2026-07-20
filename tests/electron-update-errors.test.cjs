const assert = require("node:assert/strict");
const test = require("node:test");
const { updateErrorDetails } = require("../electron/update-errors.cjs");

test("esconde o stack trace quando latest.yml não foi publicado", () => {
  const result = updateErrorDetails(new Error("Cannot find latest.yml in the latest release artifacts: HttpError: 404"));
  assert.equal(result.errorCode, "release-metadata-missing");
  assert.doesNotMatch(result.error, /HttpError|404|at ClientRequest/);
});

test("distingue falha de rede sem expor detalhes internos", () => {
  const result = updateErrorDetails(new Error("net::ERR_INTERNET_DISCONNECTED"));
  assert.equal(result.errorCode, "network");
  assert.match(result.error, /conexão/i);
});

test("usa mensagem segura para erros desconhecidos", () => {
  const result = updateErrorDetails(new Error("segredo interno no stack"));
  assert.equal(result.errorCode, "unknown");
  assert.doesNotMatch(result.error, /segredo interno/);
});
