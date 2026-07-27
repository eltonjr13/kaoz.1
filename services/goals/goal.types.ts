export type AutonomousGoalStatus =
  | "planning"
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "blocked";

export type AutonomousGoal = {
  id: string;
  requestId?: string;
  conversationId?: string;
  objective: string;
  autonomyMode: "limited";
  status: AutonomousGoalStatus;
  jobId?: string;
  flow?: "image" | "video" | "ad-creative";
  result?: Record<string, unknown>;
  error?: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateAutonomousGoalInput = {
  requestId?: string;
  conversationId?: string;
  objective: string;
};

