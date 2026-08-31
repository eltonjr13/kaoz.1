import type { PersonaTrainingExample } from './types.ts';

const TOKEN_PATTERN = /[\p{L}\p{N}]+/gu;
const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'um', 'uma',
  'para', 'por', 'com', 'que', 'na', 'no', 'nas', 'nos', 'eu', 'voce', 'você',
]);

function tokenize(value: string): Set<string> {
  const tokens = value.toLowerCase().match(TOKEN_PATTERN) || [];
  return new Set(tokens.filter((token) => token.length > 1 && !STOPWORDS.has(token)));
}

function similarity(query: Set<string>, candidate: Set<string>): number {
  if (query.size === 0 || candidate.size === 0) return 0;
  let intersection = 0;
  for (const token of query) if (candidate.has(token)) intersection += 1;
  return intersection / Math.sqrt(query.size * candidate.size);
}

export function selectRelevantPersonaExamples(
  examples: PersonaTrainingExample[],
  query: string,
  limit = 6
): PersonaTrainingExample[] {
  const queryTokens = tokenize(query);
  const ranked = examples.map((example, index) => ({
    example,
    index,
    score: similarity(queryTokens, tokenize(example.input)),
  }));

  return ranked
    .sort((a, b) => b.score - a.score || b.index - a.index)
    .slice(0, limit)
    .map(({ example }) => example);
}
