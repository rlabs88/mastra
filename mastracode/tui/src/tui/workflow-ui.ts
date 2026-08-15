import { parseUpstreamWorkflowProgress, type UpstreamWorkflowProgress } from '@mastra/core/agent-controller';

export {
  parseUpstreamWorkflowProgress,
  type UpstreamWorkflowProgress,
  type UpstreamWorkflowProgressPhase,
} from '@mastra/core/agent-controller';

export interface StoredWorkflowDefinitionView {
  readonly id: string;
  readonly description?: string;
  readonly status: string;
  readonly inputSchema?: unknown;
  readonly outputSchema?: unknown;
  readonly graph?: unknown[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

export function parseStoredWorkflowDefinition(value: unknown): StoredWorkflowDefinitionView | undefined {
  if (!isRecord(value) || typeof value.id !== 'string' || !value.id || typeof value.status !== 'string') {
    return undefined;
  }
  if (value.graph !== undefined && !Array.isArray(value.graph)) return undefined;
  return {
    id: value.id,
    status: value.status,
    ...(typeof value.description === 'string' ? { description: value.description } : {}),
    ...(value.inputSchema !== undefined ? { inputSchema: value.inputSchema } : {}),
    ...(value.outputSchema !== undefined ? { outputSchema: value.outputSchema } : {}),
    ...(Array.isArray(value.graph) ? { graph: value.graph } : {}),
  };
}

function renderSchemaOneLine(schema: unknown): string {
  if (!isRecord(schema)) return '<schema>';
  const properties = isRecord(schema.properties) ? schema.properties : undefined;
  if (!properties) return typeof schema.type === 'string' ? `<${schema.type}>` : '<schema>';
  const parts = Object.entries(properties).map(([key, rawProperty]) => {
    const property = isRecord(rawProperty) ? rawProperty : {};
    const type = typeof property.type === 'string' ? property.type : 'unknown';
    return `${key}: ${type === 'object' ? '{...}' : type === 'array' ? '[...]' : type}`;
  });
  return `{ ${parts.join(', ')} }`;
}

function entryLabel(entry: Record<string, unknown>): { title: string; detail: string } {
  const id = typeof entry.id === 'string' ? entry.id : '(unnamed)';
  const type = typeof entry.type === 'string' ? entry.type : 'step';
  if (type === 'agent') return { title: id, detail: `agent → ${String(entry.agentId ?? '?')}` };
  if (type === 'tool') return { title: id, detail: `tool → ${String(entry.toolId ?? '?')}` };
  if (type === 'workflow') return { title: id, detail: `workflow → ${String(entry.workflowId ?? '?')}` };
  if (type === 'step') return { title: id, detail: `step → ${String(entry.stepId ?? '?')}` };
  if (type === 'foreach') return { title: `foreach(${id})`, detail: 'foreach' };
  if (type === 'parallel' || type === 'conditional') {
    const count = Array.isArray(entry.steps) ? entry.steps.length : 0;
    return { title: id, detail: `${type} — ${count} branch${count === 1 ? '' : 'es'}` };
  }
  return { title: id, detail: type };
}

/** Compact, terminal-safe projection used inside a workflow tool card. */
export function renderWorkflowDefinition(definition: StoredWorkflowDefinitionView): string {
  const lines = [`${definition.id}  (${definition.status})`];
  if (definition.description) lines.push(definition.description);
  lines.push('', `Input:   ${renderSchemaOneLine(definition.inputSchema)}`);
  lines.push(`Output:  ${renderSchemaOneLine(definition.outputSchema)}`, '');
  const graph = (definition.graph ?? []).filter(isRecord);
  if (graph.length === 0) return [...lines, '(no steps)'].join('\n');

  const innerWidth = 43;
  const top = `┌${'─'.repeat(innerWidth)}┐`;
  const flatBottom = `└${'─'.repeat(innerWidth)}┘`;
  const connectedBottom = `└${'─'.repeat(21)}┬${'─'.repeat(21)}┘`;
  const connection = `${' '.repeat(22)}│\n${' '.repeat(22)}▼`;
  const pad = (text: string) => {
    const bounded = text.length > innerWidth - 2 ? `${text.slice(0, innerWidth - 3)}…` : text;
    return ` ${bounded.padEnd(innerWidth - 1)}`;
  };

  graph.forEach((entry, index) => {
    const label = entryLabel(entry);
    const last = index === graph.length - 1;
    lines.push(top, `│${pad(`${index + 1}. ${label.title}`)}│`, `│${pad(label.detail)}│`);
    lines.push(last ? flatBottom : connectedBottom);
    lines.push(last ? `${' '.repeat(19)}(output)` : connection);
  });
  return lines.join('\n');
}

export function formatWorkflowProgressLine(progress: UpstreamWorkflowProgress): string {
  if (progress.phase === 'run-start') return `run ${progress.runId} · started`;
  if (progress.phase === 'run-finish') {
    const detail = progress.error ? ` · ${progress.error}` : '';
    return `run ${progress.runId} · ${progress.status ?? 'finished'}${detail}`;
  }
  const duration = progress.durationMs === undefined ? '' : ` · ${progress.durationMs}ms`;
  return `${progress.stepId ?? '(step)'} · ${progress.phase === 'step-start' ? 'running' : (progress.status ?? 'done')}${duration}`;
}
