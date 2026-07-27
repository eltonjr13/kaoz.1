import { NextResponse } from "next/server";
import { findLocalJob } from "@/lib/local-store";
import {
  autonomousGoalStore,
  goalHelpText,
  type AutonomousGoal,
} from "@/services/goals";

export const dynamic = "force-dynamic";

function statusMessage(goal: AutonomousGoal): string {
  const job = goal.jobId ? ` Job: \`${goal.jobId}\`.` : "";
  const error = goal.error ? ` Motivo: ${goal.error}` : "";
  return `Objetivo \`${goal.id}\`: **${goal.status}**.${job}${error}\n\n${goal.objective}`;
}

async function synchronizeGoal(goal: AutonomousGoal): Promise<AutonomousGoal> {
  if (!goal.jobId || goal.status === "completed" || goal.status === "failed") return goal;
  const job = await findLocalJob(goal.jobId);
  if (!job) return goal;

  if (job.status === "completed") {
    return await autonomousGoalStore.setStatus(goal.id, "completed", {
      result: {
        finalVideoPath: job.final_video_path,
        sourceDescription: job.source_video_description,
        sourceTranscription: job.source_video_transcription,
      },
    }) || goal;
  }
  if (job.status === "failed") {
    return await autonomousGoalStore.setStatus(goal.id, "failed", {
      error: job.error_message || "A execução vinculada falhou.",
    }) || goal;
  }
  if (goal.status !== "running") {
    return await autonomousGoalStore.setStatus(goal.id, "running") || goal;
  }
  return goal;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const goalId = url.searchParams.get("id")?.trim();
  const conversationId = url.searchParams.get("conversationId")?.trim();

  if (goalId) {
    const goal = await autonomousGoalStore.find(goalId);
    if (!goal) return NextResponse.json({ error: "Objetivo não encontrado." }, { status: 404 });
    const synchronized = await synchronizeGoal(goal);
    return NextResponse.json({
      success: true,
      goal: synchronized,
      message: statusMessage(synchronized),
    });
  }

  const goals = await autonomousGoalStore.list(conversationId);
  const synchronized = await Promise.all(goals.map(synchronizeGoal));
  return NextResponse.json({
    success: true,
    goals: synchronized,
    message: synchronized[0] ? statusMessage(synchronized[0]) : goalHelpText(),
  });
}

