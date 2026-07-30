export type MediaByteRange = {
  start: number;
  end: number;
};

function suffixRange(rawSuffix: string, fileSize: number): MediaByteRange {
  const suffixLength = Number(rawSuffix);
  if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
    throw new RangeError("Faixa de mídia inválida.");
  }
  return {
    start: Math.max(0, fileSize - suffixLength),
    end: fileSize - 1,
  };
}

function explicitRange(
  rawStart: string,
  rawEnd: string,
  fileSize: number,
): MediaByteRange {
  const start = Number(rawStart);
  const requestedEnd = rawEnd ? Number(rawEnd) : fileSize - 1;
  const invalidNumber = !Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd);
  const invalidBounds = start < 0 || start >= fileSize || requestedEnd < start;
  if (invalidNumber || invalidBounds) {
    throw new RangeError("Faixa de mídia fora do arquivo.");
  }
  return {
    start,
    end: Math.min(requestedEnd, fileSize - 1),
  };
}

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
  return match[1]
    ? explicitRange(match[1], match[2], fileSize)
    : suffixRange(match[2], fileSize);
}
