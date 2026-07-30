function percentile(values: number[], ratio: number) {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * ratio)] || 0;
}

function bucketLevel(samples: Float32Array, start: number, end: number) {
  let peak = 0;
  let sumSquares = 0;
  const sampleCount = Math.max(1, end - start);
  for (let index = start; index < end; index += 1) {
    const amplitude = Math.abs(samples[index] || 0);
    peak = Math.max(peak, amplitude);
    sumSquares += amplitude * amplitude;
  }
  const rms = Math.sqrt(sumSquares / sampleCount);
  return (rms * 0.75) + (peak * 0.25);
}

export function createAudioWaveformPeaks(
  samples: Float32Array,
  pointCount: number,
) {
  if (!samples.length) return Array.from({ length: pointCount }, () => 0);
  const levels = Array.from({ length: pointCount }, (_, pointIndex) => {
    const start = Math.floor((pointIndex * samples.length) / pointCount);
    const end = Math.max(
      start + 1,
      Math.floor(((pointIndex + 1) * samples.length) / pointCount),
    );
    return bucketLevel(samples, start, Math.min(end, samples.length));
  });
  const audibleLevels = levels.filter((level) => level > 0.00001);
  const referenceLevel = Math.max(percentile(audibleLevels, 0.95), 0.0001);
  return levels.map((level) => {
    if (level <= 0.00001) return 0;
    const normalized = Math.sqrt(Math.min(1, level / referenceLevel));
    return Number(normalized.toFixed(4));
  });
}
