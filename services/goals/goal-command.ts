export type GoalCommand =
  | { kind: "create"; objective: string }
  | { kind: "status"; goalId?: string }
  | { kind: "help" };

const GOAL_COMMAND_PATTERN = /^\s*\/goal(?:@[a-z0-9._-]+)?(?:\s+([\s\S]*))?$/i;

export function parseGoalCommand(value: string): GoalCommand | null {
  const match = value.match(GOAL_COMMAND_PATTERN);
  if (!match) return null;

  const argument = (match[1] || "").trim();
  if (!argument) return { kind: "help" };

  const status = argument.match(/^(?:status|estado)(?:\s+([a-z0-9-]+))?$/i);
  if (status) {
    return {
      kind: "status",
      goalId: status[1]?.trim() || undefined,
    };
  }

  return { kind: "create", objective: argument };
}

export function goalHelpText(): string {
  return [
    "**Modo Goal**",
    "`/goal <objetivo>` — cria um objetivo persistente e inicia automaticamente uma execução suportada.",
    "`/goal status` — mostra o objetivo mais recente desta conversa.",
    "`/goal status <id>` — consulta um objetivo específico.",
    "O modo autônomo executa imagens, vídeos e criativos. Ações externas, destrutivas ou sem capacidade instalada continuam bloqueadas.",
  ].join("\n");
}

