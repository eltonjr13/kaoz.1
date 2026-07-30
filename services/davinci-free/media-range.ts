export type MediaByteRange = {
  start: number;
  end: number;
};

export function parseMediaByteRange(
  value: string | null,
  fileSize: number,
): MediaByteRange | null {
  if (!value) return null;
  if (!Number.isSafeInteger(fileSize) || fileSize <= 0) {
    throw new RangeError("Tamanho de mídia inválido.");
  }

  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim());
  if (!match || (!match[1] && !match[2])) {
    throw new RangeError("Faixa de mídia inválida.");
  }

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
      throw new RangeError("Faixa de mídia inválida.");
    }
    return {
      start: Math.max(0, fileSize - suffixLength),
      end: fileSize - 1,
    };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : fileSize - 1;
  if (
    !Number.isSafeInteger(start)
    || !Number.isSafeInteger(requestedEnd)
    || start < 0
    || start >= fileSize
    || requestedEnd < start
  ) {
    throw new RangeError("Faixa de mídia fora do arquivo.");
  }

  return {
    start,
    end: Math.min(requestedEnd, fileSize - 1),
  };
}
