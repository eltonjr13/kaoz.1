import type { SketchJobStep } from '../../types/sketch.ts';

export const ACTIVE_JOB_STEPS = new Set<SketchJobStep>([
  'queued',
  'preparing_reference',
  'waiting_flow_lock',
  'generating_with_flow',
  'verifying_output',
]);

export const TERMINAL_JOB_STEPS = new Set<SketchJobStep>([
  'completed',
  'failed',
  'cancelled',
  'interrupted',
]);

export function isJobActive(status: SketchJobStep | null | undefined): boolean {
  if (!status) return false;
  return ACTIVE_JOB_STEPS.has(status);
}

export function isJobTerminal(status: SketchJobStep | null | undefined): boolean {
  if (!status) return false;
  return TERMINAL_JOB_STEPS.has(status);
}
