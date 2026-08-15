export const UPSTREAM_WORKFLOW_PROGRESS_DATA_TYPE = 'data-upstream-workflow-progress' as const;

export type UpstreamWorkflowProgressPhase = 'run-start' | 'step-start' | 'step-result' | 'run-finish';

export interface UpstreamWorkflowProgress {
  readonly version: 1;
  readonly toolCallId: string;
  readonly workflowId: string;
  readonly runId: string;
  readonly sequence: number;
  readonly phase: UpstreamWorkflowProgressPhase;
  readonly stepId?: string;
  readonly status?: string;
  readonly durationMs?: number;
  readonly error?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isProgressPhase(value: unknown): value is UpstreamWorkflowProgressPhase {
  return value === 'run-start' || value === 'step-start' || value === 'step-result' || value === 'run-finish';
}

/** Canonical parser for the durable AgentController-to-TUI workflow progress protocol. */
export function parseUpstreamWorkflowProgress(value: unknown): UpstreamWorkflowProgress | undefined {
  if (!isRecord(value)) return undefined;
  if (
    value.version !== 1 ||
    typeof value.toolCallId !== 'string' ||
    !value.toolCallId ||
    typeof value.workflowId !== 'string' ||
    !value.workflowId ||
    typeof value.runId !== 'string' ||
    !value.runId ||
    typeof value.sequence !== 'number' ||
    !Number.isFinite(value.sequence) ||
    !isProgressPhase(value.phase)
  ) {
    return undefined;
  }
  if (value.stepId !== undefined && typeof value.stepId !== 'string') return undefined;
  if (value.status !== undefined && typeof value.status !== 'string') return undefined;
  if (value.durationMs !== undefined && (typeof value.durationMs !== 'number' || !Number.isFinite(value.durationMs))) {
    return undefined;
  }
  if (value.error !== undefined && typeof value.error !== 'string') return undefined;
  return value as unknown as UpstreamWorkflowProgress;
}
