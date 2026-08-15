/**
 * Parent-mode tool: run a saved workflow with input data. Returns the run
 * result inline so the parent agent can summarise / chain it.
 */
import { UPSTREAM_WORKFLOW_PROGRESS_DATA_TYPE, type UpstreamWorkflowProgress } from '@mastra/core/agent-controller';
import type { Mastra } from '@mastra/core/mastra';
import { createTool } from '@mastra/core/tools';
import { z } from 'zod';
import { runWorkflow } from '../../workflows/service.js';
import { withEphemeralMemory } from './ephemeral-memory.js';

export const runWorkflowTool = createTool({
  id: 'run-workflow',
  description:
    'Run a saved workflow by id with the provided input data. Returns the run result inline. Use when the user asks you to "run X", "execute X", or asks for the outcome of a saved workflow.',
  inputSchema: z.object({
    workflowId: z.string().describe('The id of the saved workflow to run.'),
    inputData: z.any().describe('The input object the workflow consumes. Must match the workflow inputSchema.'),
  }),
  outputSchema: z.object({
    status: z.string(),
    result: z.any().optional(),
    error: z.any().optional(),
  }),
  execute: async ({ workflowId, inputData }, context) => {
    const { mastra, requestContext } = context;
    if (!mastra) throw new Error('run-workflow requires a Mastra context.');
    // Forward the caller's requestContext so agent steps can resolve dynamic
    // model/tool bindings from session state, and swap the caller's chat
    // memory scope for a fresh isolated one for the duration of the run so
    // the workflow's agent step doesn't write into (or read from) the parent
    // chat thread. See ephemeral-memory.ts.
    return withEphemeralMemory(requestContext, async ephemeralRequestContext => {
      const toolCallId = context.agent?.toolCallId;
      let runId: string | undefined;
      let sequence = 0;
      const timings = new Map<string, number>();
      const writeProgress = async (
        progress: Omit<UpstreamWorkflowProgress, 'version' | 'toolCallId' | 'workflowId' | 'runId' | 'sequence'>,
      ) => {
        if (!toolCallId || !runId) return;
        await context.writer?.custom({
          type: UPSTREAM_WORKFLOW_PROGRESS_DATA_TYPE,
          data: { version: 1, toolCallId, workflowId, runId, sequence: sequence++, ...progress },
          transient: true,
        });
      };
      const result = await runWorkflow(
        mastra as Mastra,
        workflowId,
        inputData,
        ephemeralRequestContext,
        async event => {
          const stepId = typeof event.payload?.id === 'string' ? event.payload.id : undefined;
          if (!stepId) return;
          if (event.type === 'workflow-step-start') {
            timings.set(stepId, Date.now());
            await writeProgress({ phase: 'step-start', stepId });
          } else if (event.type === 'workflow-step-result') {
            const started = timings.get(stepId);
            await writeProgress({
              phase: 'step-result',
              stepId,
              ...(typeof event.payload?.status === 'string' ? { status: event.payload.status } : {}),
              ...(started === undefined ? {} : { durationMs: Date.now() - started }),
            });
          }
        },
        async id => {
          runId = id;
          await writeProgress({ phase: 'run-start' });
        },
      );
      await writeProgress({
        phase: 'run-finish',
        status: result.status,
        ...(result.error ? { error: result.error instanceof Error ? result.error.message : String(result.error) } : {}),
      });
      if (result.status === 'tripwire' && result.tripwire) {
        return {
          status: result.status,
          error: `Tripwire: ${result.tripwire.reason ?? 'unknown'} (processor: ${result.tripwire.processorId ?? 'unknown'})`,
        };
      }
      let errorText: string | undefined;
      if (result.error instanceof Error) {
        errorText = `${result.error.name}: ${result.error.message}`;
        const cause = (result.error as { cause?: unknown }).cause;
        if (cause) {
          try {
            errorText += ` | cause: ${JSON.stringify(cause, Object.getOwnPropertyNames(cause))}`;
          } catch {
            errorText += ` | cause: ${String(cause)}`;
          }
        }
        if (result.error.stack) errorText += `\nstack: ${result.error.stack}`;
      } else if (result.error) {
        try {
          errorText = JSON.stringify(result.error, Object.getOwnPropertyNames(result.error));
        } catch {
          errorText = String(result.error);
        }
      }
      return { status: result.status, result: result.result, error: errorText };
    });
  },
});
