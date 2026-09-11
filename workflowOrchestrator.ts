/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { EvixorCtx, createProxiedCtx } from "./context";
import { HostLayerLite, HostLayerFull } from "./hostLayer";
import { PersistLayer } from "./persistLayer";
import { PipelineEndEvent, SubpipelineStartEvent, TimelineItem } from "./timelineEvents";
import { EvixorRunOptions, PipelineId } from "./types";
import { parsePipelineId, pipelineIdToString } from "./utilities";

// function debug(msg: string, handler?: (msg: string) => void) {
//   if (handler) {
//     handler(msg);
//   }
// }

/**
 * Ensure a posthoc pipelineId exists on ctx.control.continue.
 * If not, create one, submit a timeline item, and save ctx.
 * Returns the pipelineId string.
 */
async function ensurePosthocPipelineId(
  ctx: EvixorCtx,
  continueType: "reRun" | "nextPipeline" | "subpipeline",
  pipeline: string,
  rootId: string,
  persistLayer: PersistLayer,
): Promise<string> {
  if (ctx.control.continue?.pipelineId) {
    return ctx.control.continue.pipelineId
  }
  const plId = await persistLayer.newPipelineId(pipeline, rootId, ctx)
  const pid = pipelineIdToString(plId)
  ctx.control.continue!.pipelineId = pid

  if (continueType === "subpipeline") {
    const item: TimelineItem = {
      pipelineId: ctx.pipelineId,
      timestamp: Date.now(),
      type: "subpipeline-start",
      data: {
        stepIndex: ctx.meta.stepIndex,
        pipeline,
        childPipelineId: pid,
        payload: ctx.current.feed,
      } as SubpipelineStartEvent,
    }
    await persistLayer.submitTimelineItem(ctx, item)
  }

  await persistLayer.saveCtx(ctx.pipelineId, ctx)
  return pid
}

/**
 * Start a posthoc workflow if its payload doesn't already exist.
 * Returns true if the workflow was started, false if skipped (payload exists).
 */
async function startPosthocWorkflow(
  ctx: EvixorCtx,
  pipeline: string,
  payload: any,
  persistLayer: PersistLayer,
  hostLayer: HostLayerLite,
): Promise<boolean> {
  const pidStr = ctx.control.continue!.pipelineId!
  if (await persistLayer.loadPayload(pidStr)) {
    return false
  }
  await startWorkflow(pipeline, payload, { precreatedPipelineId: parsePipelineId(pidStr) }, persistLayer, hostLayer)
  return true
}

export async function signalWorkflow(
  rootId: string,
  persistLayer: PersistLayer,
  hostLayer: HostLayerFull,
  options?: EvixorRunOptions
): Promise<"terminated" | "continue" | "pending" | undefined> {
  const ownerToken = await persistLayer.acquireLock(rootId);
  if (!ownerToken) return;
  if (options?.simulateBroken?.(rootId, "orchestrator:after-acquire-lock")) return;

  let result, jsonPipelineId, pipelineIdStr;
  try {
    jsonPipelineId = await persistLayer.getWorkflowToActivate(rootId);
    if (!jsonPipelineId) return;
    pipelineIdStr = pipelineIdToString(jsonPipelineId);
    if (options?.simulateBroken?.(rootId, "orchestrator:after-get-workflow")) return;

    const pl = hostLayer.loadPipeline(jsonPipelineId.pipeline);
    if (options?.simulateBroken?.(rootId, "orchestrator:after-load-pipeline")) return;

    const runOptions: EvixorRunOptions = { ...options, lockOwnerToken: ownerToken };
    result = await pl.run(pipelineIdStr, jsonPipelineId.pipeline, persistLayer, runOptions);
    if (options?.mock) {
      return "terminated";
    }

    if (
      result?.context?.meta.lifecycleStatus === "error"
      || result?.context?.meta.lifecycleStatus === "timeout"
      || result?.context?.meta.lifecycleStatus === "abort"
    ) {
      await terminatePendingPipelines(
        result.context.pipelineId.rootId,
        result.context.meta.lifecycleStatus,
        persistLayer,
        hostLayer,
        result.context.pipelineId);

      return "terminated";
    } else if (
      result?.context?.control.continue?.type === "reRun"
      || result?.context?.control.continue?.type === "nextPipeline"
      || result?.context?.control.continue?.type === "subpipeline"
    ) {
      const continueType = result.context.control.continue.type
      const pipeline = continueType === "reRun"
        ? jsonPipelineId.pipeline
        : result.context.control.continue.pipeline

      await ensurePosthocPipelineId(result.context, continueType, pipeline, jsonPipelineId.rootId, persistLayer)

      if (continueType === "nextPipeline") {
        await terminatePendingPipelines(
          result.context.pipelineId.rootId,
          "done",
          persistLayer,
          hostLayer,
          result.context.pipelineId);
      }
    }

  } finally {
    const missedEvent = await persistLayer.releaseLock(rootId, ownerToken);
    if (missedEvent) {
      await hostLayer.queuePipeline(rootId);
    }
    if (options?.simulateBroken?.(rootId, "orchestrator:after-release-lock")) return;
    /*
      KNOWN GAP (crash recovery):
      Lock released here, but continue branch (reRun / nextPipeline / subpipeline enqueued)
      executes AFTER releaseLock (see reRun/nextPipeline/subpipeline branch below).
      If process is killed in the millisecond window between these two:
      - Pipeline already queued → startup recovery (listLockedRootIds) won't find it → won't auto re-run
      - Pipeline not yet queued → won't be recovered either
      This window is accepted and documented; extreme cases handled by step's idempotencyGuard
      (on re-run, checks if external side effects are already complete; if so, skips step and injects recorded output).
    */
  }

  // if (result?.context?.control.continue?.type === "me"){
  //   await resumeWorkflow(pipelineIdStr, pipeline, hostLayer);
  //   return "continue";
  // } else
  if (
    result?.context?.control.continue?.type === "reRun"
    || result?.context?.control.continue?.type === "nextPipeline"
    || result?.context?.control.continue?.type === "subpipeline"
  ) {
    const continueType = result.context.control.continue.type
    const pipeline = continueType === "reRun"
      ? jsonPipelineId.pipeline
      : result.context.control.continue.pipeline

    const started = await startPosthocWorkflow(
      result.context, pipeline, result.context.current.feed, persistLayer, hostLayer)

    if (!started) return "pending"
    return "continue"
  } else if (result?.context?.meta.lifecycleStatus === "done") {
    /**
     * Completed successfully, no need for continue reRun/nextPipeline/subpipeline
     * This is a true end
     * Check if parent pipeline needs resume
     */
    const parentWid = await persistLayer.getPendingPipelineToResume(result.context.pipelineId.rootId);
    // Resume parent pipeline
    if (parentWid) {
      await persistLayer.enqueueSubpipelineReturns(
        result.context.pipelineId.rootId,
        result.context.pipeline,
        result.context.current.drop);
      await resumeWorkflow(parentWid.rootId, parentWid.pipeline, hostLayer);

      return "continue";
    }

    return "terminated";
  } if (result?.context?.meta.lifecycleStatus === "pending") {
    return "pending";
  }

  throw new Error("Unknow lifecycle status.");
}

async function terminatePendingPipelines(
  rootId: string,
  lifecycleStatus: "done" | "error" | "timeout" | "abort",
  persistLayer: PersistLayer,
  hostLayer: HostLayerFull,
  causedBy: PipelineId,
) {
  const pids = await persistLayer.terminatePendingPipelines(
    rootId,
    lifecycleStatus);

  if (pids?.length ?? 0 > 0) {
    // Sorted in reverse order
    pids.sort((a, b) => (b.timestamp - a.timestamp));
    for (let i = 0; i < (pids?.length ?? 0); ++i) {
      const pid = pids![i];
      const parentCtx = await persistLayer.loadCtx(pid);
      if (parentCtx) {
        const parentPl = hostLayer.loadPipeline(pid.pipeline);
        const diagnosticsHandler = parentPl.getDiagnosticsHandler();
        const finallyHandler = parentPl.getFinallyHandler();

        if (diagnosticsHandler && parentCtx) {
          await diagnosticsHandler(createProxiedCtx(parentCtx));
        }

        if (finallyHandler) {
          await finallyHandler(createProxiedCtx(parentCtx));
        }

        if (lifecycleStatus != "done") {
          const pidStr = pipelineIdToString(causedBy);
          parentCtx.warn({ terminatedBy: pidStr }, `Terminated by [${pidStr}]'s ${lifecycleStatus}`);
        }

        const item: TimelineItem = {
          pipelineId: parentCtx.pipelineId,
          timestamp: Date.now(),
          type: "pipeline-end",
          data: {
            pipeline: parentCtx.pipeline,
            lifecycleStatus: lifecycleStatus,
            drop: [],
            reference: parentCtx.reference,
            warnings: parentCtx.warnings,
            errors: parentCtx.errors
          } as PipelineEndEvent,
        };
        await persistLayer.submitTimelineItem(parentCtx, item);
        await persistLayer.saveCtx(parentCtx.pipelineId, parentCtx);
      }
    }
  }
}

export type StartWorkflowOptions =
  | { rootId?: string }
  | { parentCtx: EvixorCtx }
  | { precreatedPipelineId: PipelineId }

export async function startWorkflow(
  pipeline: string,
  payload: any,
  options: StartWorkflowOptions = {},
  persistLayer: PersistLayer,
  hostLayer: HostLayerLite
): Promise<string> {
  const parentCtx = "parentCtx" in options ? options.parentCtx : undefined
  const precreatedPipelineId = "precreatedPipelineId" in options ? options.precreatedPipelineId : undefined
  const rootId = precreatedPipelineId?.rootId
    ?? parentCtx?.pipelineId.rootId
    ?? ("rootId" in options ? options.rootId : undefined)

  const pipelineId = precreatedPipelineId ?? (await persistLayer.newPipelineId(pipeline, rootId, parentCtx))
  const strPipelineId = pipelineIdToString(pipelineId)
  await persistLayer.savePayload(strPipelineId, pipeline, payload, !rootId)
  await hostLayer.queuePipeline(pipelineId.rootId, pipeline)
  return strPipelineId
}

export async function rerunWorkflow(
  pipelineId: string,
  payload: any,
  persistLayer: PersistLayer,
  hostLayer: HostLayerLite
): Promise<string> {
  const jsonPipelineId = parsePipelineId(pipelineId);
  await persistLayer.savePayload(pipelineId, jsonPipelineId.pipeline, payload, false);
  await hostLayer.queuePipeline(jsonPipelineId.rootId, jsonPipelineId.pipeline);
  return pipelineId;
}

export async function resumeWorkflow(
  rootId: string,
  pipeline: string,
  hostLayer: HostLayerLite
) {
  await hostLayer.queuePipeline(rootId, pipeline);
}

export async function receivePendingInputs(
  rootId: string,
  pipeline: string,
  inputs: {
    sessionId: string;
    role: string;
    input: any;
  }[],
  persistLayer: PersistLayer,
  hostLayer: HostLayerLite
) {
  await persistLayer.enqueuePendingInputs(rootId, inputs);
  await resumeWorkflow(rootId, pipeline, hostLayer);
}

