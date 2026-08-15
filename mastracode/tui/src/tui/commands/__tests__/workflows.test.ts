import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  deleteWorkflow: vi.fn(),
  getWorkflow: vi.fn(),
  listWorkflows: vi.fn(),
  runWorkflow: vi.fn(),
}));

vi.mock('@mastra/code-sdk/workflows/service', () => ({
  deleteWorkflow: mocks.deleteWorkflow,
  getWorkflow: mocks.getWorkflow,
  listWorkflows: mocks.listWorkflows,
  runWorkflow: mocks.runWorkflow,
}));

import { handleWorkflowsCommand } from '../workflows.js';

function createCtx() {
  return {
    state: { options: {} },
    controller: {
      getMastra: vi.fn(() => undefined),
    },
    showError: vi.fn(),
    showInfo: vi.fn(),
  } as any;
}

function createRemoteCtx() {
  const workflowReader = {
    list: vi.fn(async () => [{ id: 'MixedCaseFlow', status: 'active', description: 'Echoes a name', graph: [] }]),
    get: vi.fn(async (id: string) => ({
      id,
      status: 'active',
      description: 'Echoes a name',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
      outputSchema: { type: 'object', properties: { message: { type: 'string' } } },
      graph: [{ type: 'mapping', id: 'copy-input' }],
    })),
  };
  const ctx = createCtx();
  ctx.state.options.backend = {
    capabilities: { localControlPlane: false, workflows: true },
    workflowReader,
  };
  return { ctx, workflowReader };
}

describe('handleWorkflowsCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runWorkflow.mockReset();
  });

  it.each([{ args: [] }, { args: ['list'] }])(
    'lists remote workflows for command arguments $args',
    async ({ args }) => {
      const { ctx, workflowReader } = createRemoteCtx();

      await handleWorkflowsCommand(ctx, args);

      expect(workflowReader.list).toHaveBeenCalledTimes(1);
      expect(ctx.showInfo).toHaveBeenCalledWith('- MixedCaseFlow (active) — Echoes a name');
    },
  );

  it.each([
    ['explicit show', ['show', 'MixedCaseFlow']],
    ['shorthand', ['MixedCaseFlow']],
  ])('preserves the workflow id case for %s', async (_label, args) => {
    const { ctx, workflowReader } = createRemoteCtx();

    await handleWorkflowsCommand(ctx, args);

    expect(workflowReader.get).toHaveBeenCalledWith('MixedCaseFlow');
    expect(ctx.showInfo).toHaveBeenCalledWith(expect.stringContaining('MixedCaseFlow  (active)'));
  });

  it.each(['run', 'delete'])('keeps remote %s behind the upstream agent tool', async subcommand => {
    const { ctx } = createRemoteCtx();

    await handleWorkflowsCommand(ctx, [subcommand, 'MixedCaseFlow']);

    expect(ctx.showError).toHaveBeenCalledWith(
      `/workflows ${subcommand} is unavailable in remote mode; ask the agent to use ${subcommand}-workflow.`,
    );
  });

  it.each(['help', '?', '--help'])('shows %s without requiring a Mastra instance', async subcommand => {
    const ctx = createCtx();

    await handleWorkflowsCommand(ctx, [subcommand]);

    expect(ctx.controller.getMastra).not.toHaveBeenCalled();
    expect(ctx.showError).not.toHaveBeenCalled();
    expect(ctx.showInfo).toHaveBeenCalledWith(expect.stringContaining('Dynamic Workflows'));
  });

  it('preserves repeated spaces in workflow run JSON input', async () => {
    const mastra = {};
    const ctx = createCtx();
    ctx.controller.getMastra.mockReturnValue(mastra);
    mocks.runWorkflow.mockResolvedValue({ status: 'success', result: { greeting: 'Hello' } });

    await handleWorkflowsCommand(
      ctx,
      ['run', 'greeting', '{"name":"Ada', 'Lovelace"}'],
      'run greeting {"name":"Ada  Lovelace"}',
    );

    expect(mocks.runWorkflow).toHaveBeenCalledWith(
      mastra,
      'greeting',
      { name: 'Ada  Lovelace' },
      undefined,
      expect.any(Function),
    );
    expect(ctx.showError).not.toHaveBeenCalled();
  });

  it.each([
    ['a string', 'connection lost'],
    ['an object with a message', { message: 'connection lost' }],
  ])('preserves non-Error workflow command failures from %s', async (_source, failure) => {
    const ctx = createCtx();
    ctx.controller.getMastra.mockReturnValue({});
    mocks.runWorkflow.mockRejectedValue(failure);

    await handleWorkflowsCommand(ctx, ['run', 'greeting'], 'run greeting {}');

    expect(ctx.showError).toHaveBeenCalledWith('Workflow command failed: connection lost');
  });
});
