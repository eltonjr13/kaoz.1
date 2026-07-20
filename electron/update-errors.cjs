function updateErrorDetails(error) {
  const raw = error instanceof Error ? `${error.message}\n${error.stack || ""}` : String(error || "");

  if (/latest\.ya?ml/i.test(raw) && /(?:404|cannot find)/i.test(raw)) {
    return {
      errorCode: "release-metadata-missing",
      error: "A versão mais recente ainda não está pronta para atualização automática. Tente novamente mais tarde."
    };
  }

  if (/ERR_INTERNET_DISCONNECTED|ERR_NETWORK_CHANGED|ENOTFOUND|EAI_AGAIN|ETIMEDOUT|ECONNRESET|socket hang up/i.test(raw)) {
    return {
      errorCode: "network",
      error: "Não foi possível acessar o servidor de atualizações. Verifique sua conexão e tente novamente."
    };
  }

  return {
    errorCode: "unknown",
    error: "Não foi possível verificar atualizações agora. Tente novamente mais tarde."
  };
}

module.exports = { updateErrorDetails };
