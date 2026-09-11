/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { execUserFn } from "../utilities";
import { runDiagnosticsIfNeeded, runFinallyIfNeeded } from "./handlers";
import { runStepParallel } from "./runStepParallel";
import { runStepSingle } from "./runStepSingle";

import { createCtx, createProxiedCtx, EvixorCtx } from "../context";
import { EvixorRuntime } from "../runtime";
import { PersistLayer } from "../persistLayer";
import {
  defaultLimits,
  EvixorRunOptions,
  PendingInputEntry,
  AskFn,
  StepConfig,
  SubpipelineReturnsEntry,
  PipelineId,
} from "../types";
import {
  deepClone,
  defaultPendingInputSessionPolicy,
  diffRef,
  execUserFnReturn,
  isExpiredByHours,
  isTerminated,
  mergeRef,
  parsePipelineId,
  pipelineIdToString,
} from "../utilities";
import {
  resetControl,
} from "../userHelpers";

import {
  NextEndEvent,
  NextStepEvent,
  PendingInputsResumeEvent,
  PendingInputsReturnEvent,
  PendingInputsWaitEvent,
  PipelineEndEvent,
  PipelineResumeEvent,
  PipelineStartEvent,
  StepEndEvent,
  StepStartEvent,
  SubpipelineResumeEvent,
  SubpipelineReturnEvent,
  SubpipelineStartEvent,
  SubpipelineWaitEvent,
  TimelineEventData,
  TimelineEventType,
  TimelineItem
} from "../timelineEvents";

async function emit(
  ctx: EvixorCtx,
  persistLayer: PersistLayer,
  type: TimelineEventType,
  data: TimelineEventData
) {
  const item: TimelineItem = {
    //eventId: crypto.randomUUID(), // If crypto.randomUUID is not supported, replace with your own ID generator
    pipelineId: ctx.pipelineId,
    timestamp: Date.now(),
    type,
    data,
  };
  return await persistLayer.submitTimelineItem(ctx, item);
}

async function finalizePipeline(ctx: EvixorCtx, persistLayer: PersistLayer): Promise<void> {
  const isDoneWithContinue = ctx.meta.lifecycleStatus === "doneWithContinue";
  await emit(ctx, persistLayer, "pipeline-end", {
    pipeline: ctx.pipeline,
    lifecycleStatus: ctx.meta.lifecycleStatus,
    drop: isDoneWithContinue ? ctx.current.feed : ctx.current.drop,
    reference: ctx.reference,
    warnings: ctx.warnings,
    errors: ctx.errors,
  } as PipelineEndEvent);

  await persistLayer.markPipelineLifecycle(
    ctx.pipelineId,
    ctx.meta.lifecycleStatus!
  );

  await persistLayer.saveCtx(ctx.pipelineId, ctx);
}


export async function runPipeline(
  pipelineIdStr: string,
  pipelineName: string,
  pipeline: any,
  persistLayer: PersistLayer,
  options?: EvixorRunOptions
) {
  const limits = { ...defaultLimits, ...options?.limits };
  const sandbox = options?.sandbox;
  const parsedPipelineId = parsePipelineId(pipelineIdStr);
  let ctx = await persistLayer.loadCtx(parsedPipelineId, options);
  if (!ctx) {
    return;
  }

  if (isTerminated(ctx)) {
    return { context: ctx };
  }

  if (!options?.mock && isExpiredByHours(parsedPipelineId.timestamp, pipeline.getTimeOut())) {
    return;
  }

  if (ctx?.meta.stepIndex === 0) {
    // Starting workflow
    // timeline: pipeline-start
    await emit(ctx, persistLayer, "pipeline-start", {
      pipeline: pipelineName,
      payload: ctx.payload,
    } as PipelineStartEvent);
  } else {
    // timeline: pipeline-resume
    await emit(ctx, persistLayer, "pipeline-resume", {
      fromStepIndex: ctx.meta.stepIndex,
    } as PipelineResumeEvent);
  }

  const pendingInputSessionId = await persistLayer.getPendingInputsSessionId(ctx.pipelineId);

  const items = pipeline.getItems();
  const startIndex = ctx.meta.stepIndex;
  let simulatedCrash = false;

  if (limits.maxStepsPerPipeline > 0 && items.length > limits.maxStepsPerPipeline) {
    ctx!.error({}, `Pipeline "${pipelineName}" violates limitation: steps [${items.length}] exceeds the maxStepsPerPipeline limit [${limits.maxStepsPerPipeline}].`, null, true);
    ctx.meta.lifecycleStatus = "error";
  } else {
    let lastLockRefresh = Date.now();
    for (let i = ctx.meta.stepIndex; i < items.length; i++) {
      if (!options?.mock && isExpiredByHours(ctx.startTime, pipeline.getTimeOut())) {
        ctx.meta.lifecycleStatus = "timeout";
        break;
      }

      const item = items[i];
      ctx.meta.stepIndex = i;

      if (Date.now() - lastLockRefresh >= 300_000) {
        lastLockRefresh = Date.now();
        if (options?.lockOwnerToken) {
          const ok = await persistLayer.refreshLock(ctx.pipelineId.rootId, options.lockOwnerToken);
          if (!ok) {
            ctx.meta.lifecycleStatus = "abort";
            break;
          }
        }
      }

      if (isTerminated(ctx)) {
        break;
      }

      if (options?.yieldEventLoop) {
        await options.yieldEventLoop();
      }

      if (
        item.type === "next" ||
        item.type === "pendingInputs" ||
        item.type === "subpipeline"
      ) {
        let subpipelineReturns: SubpipelineReturnsEntry | null = null;
        let inputs: PendingInputEntry[] | null | undefined = null;

        if (item.type === "pendingInputs") {
          if (ctx.mock?.mockPendingInput) {
            const pi = await ctx.mock.mockPendingInput(ctx);
            inputs = pi?.inputs;
            if (!inputs) { await trackUsage(ctx, options, startIndex); return; }
          } else {
            inputs = await persistLayer.dequeuePendingInputs(
              ctx.pipelineId.rootId
            );

            const policy = options?.pendingInputSessionPolicy ?? defaultPendingInputSessionPolicy;
            inputs = inputs?.filter(i => policy(pendingInputSessionId, i.sessionId));

            if (!inputs?.length) {
              ctx.meta.lifecycleStatus = "pending";
              ctx.meta.stepIndex = i;

              await emit(ctx, persistLayer, "pending-inputs-wait", {
                stepName: item.config.name,
                stepIndex: i,
              } as PendingInputsWaitEvent);

              await persistLayer.saveCtx(ctx.pipelineId, ctx);

              await trackUsage(ctx, options, startIndex);
              return { context: ctx };
            }

            await emit(ctx, persistLayer, "pending-inputs-resume", {
              stepName: item.config.name,
              stepIndex: i,
            } as PendingInputsResumeEvent);
          }
        } else if (item.type === "subpipeline") {
          if (ctx.mock?.mockSubpipelineReturn) {
            const rt = await ctx.mock.mockSubpipelineReturn(ctx);
            if (!rt) { await trackUsage(ctx, options, startIndex); return; }
            subpipelineReturns = rt.returns;
          } else           if (
            ctx.control.continue?.type === "subpipeline" &&
            ctx.control.continue?.pipelineId
          ) {
            subpipelineReturns =
              await persistLayer.dequeueSubpipelineReturns(
                ctx.pipelineId.rootId
              );

            if (!subpipelineReturns) {
              ctx.meta.lifecycleStatus = "pending";

              await emit(ctx, persistLayer, "subpipeline-wait", {
                stepIndex: i,
                pipeline: item.config.pipeline,
              } as SubpipelineWaitEvent);

              await persistLayer.saveCtx(ctx.pipelineId, ctx);

              await trackUsage(ctx, options, startIndex);
              return { context: ctx };
            }

            if (subpipelineReturns.pipeline !== item.config.pipeline) {
              ctx.meta.lifecycleStatus = "error";
              await persistLayer.saveCtx(ctx.pipelineId, ctx);

              await emit(ctx, persistLayer, "error", {
                stepIndex: i,
                message: "Subpipeline return mismatch",
                fatal: true,
              });

              break;
            }

            await emit(ctx, persistLayer, "subpipeline-resume", {
              stepIndex: i,
              pipeline: item.config.pipeline,
            } as SubpipelineResumeEvent);
          } else {
            ctx.control.continue = { type: "subpipeline", pipeline: item.config.pipeline };
            ctx.markLifecycle("pending");
            ctx.meta.stepIndex = i;
            await persistLayer.saveCtx(ctx.pipelineId, ctx);
            if (options?.simulateBroken?.(ctx.pipelineId.rootId, "run:subpipeline-setup")) {
              simulatedCrash = true;
              break;
            }

            await trackUsage(ctx, options, startIndex);
            return { context: ctx };
          }
        }

        const start = performance.now();
        const inputBefore = ctx.current.feed;
        const referenceBefore = deepClone(ctx.reference);
        const warningsBefore = ctx.warnings.length;
        const errorsBefore = ctx.errors.length;

        resetControl(ctx);
        ctx.meta.attempt = 0;

        if (item.type === "next") {
          await emit(ctx, persistLayer, "next-step", {
            stepIndex: i,
            output: ctx.current.drop,
          } as NextStepEvent);

          await execUserFn(sandbox, item.config.fn, createProxiedCtx(ctx));
        } else if (item.type === "pendingInputs") {
          if (!ctx.mock?.mockPendingInput
            && ctx.recorder?.pendingInputRecorder
            && (ctx.recorder?.needRecord?.(ctx) ?? true)) {
            await ctx.recorder.pendingInputRecorder(
              pipelineIdToString(ctx.pipelineId),
              {
                stepIndex: i,
                inputs: inputs!,
                timestamp: Date.now(),
              })
          }

          await emit(ctx, persistLayer, "pending-inputs-return", {
            stepName: item.config.name,
            stepIndex: i,
            inputs,
          } as PendingInputsReturnEvent);

          ctx.meta.lifecycleStatus = undefined;
          await execUserFn(sandbox, item.config.fn, createProxiedCtx(ctx), inputs!);
        } else if (item.type === "subpipeline") {
          if (!ctx.mock?.mockSubpipelineReturn
            && ctx.recorder?.subpipelineReturnRecorder
            && (ctx.recorder?.needRecord?.(ctx) ?? true)) {
            await ctx.recorder.subpipelineReturnRecorder(
              pipelineIdToString(ctx.pipelineId),
              {
                stepIndex: i,
                returns: subpipelineReturns!,
                timestamp: Date.now(),
              }
            )
          }

          await emit(ctx, persistLayer, "subpipeline-return", {
            stepIndex: i,
            pipeline: item.config.pipeline,
            drop: subpipelineReturns!.drops,
          } as SubpipelineReturnEvent);

          ctx.meta.lifecycleStatus = undefined;
          await execUserFn(sandbox, item.config.fn, createProxiedCtx(ctx), subpipelineReturns!);
        }

        ctx.current.drop = [];
        ctx.meta.stepName = undefined;

        const end = performance.now();

        await emit(ctx, persistLayer, "next-end", {
          stepIndex: i,
          stepName:
            item.type === "next"
              ? "(next-step)"
              : item.type === "pendingInputs"
                ? "(pendingInputs-step)"
                : "(subpipeline-step)",
          feed: ctx.current.feed,
          reference: diffRef(referenceBefore, ctx.reference),
          warnings: ctx.warnings.slice(warningsBefore),
          errors: ctx.errors.slice(errorsBefore),
          durationMs: Math.round(end - start),
        } as NextEndEvent);

        if (ctx.errors.some((e) => e.fatal)) {
          ctx.meta.lifecycleStatus = "error";
        } else if (ctx.control.continue?.type === "reRun"
          || ctx.control.continue?.type === "nextPipeline"
        ) {
          ctx.meta.lifecycleStatus = "doneWithContinue";
        }

        if (isTerminated(ctx)) {
          break;
        }

        continue;
      }

      const step: StepConfig = item.config;
      ctx.meta.stepName = step.name;
      ctx.meta.attempt = 0;

      await emit(ctx, persistLayer, "step-start", {
        stepIndex: i,
        stepName: step.name,
        feed: ctx.current.feed,
      } as StepStartEvent);

      if (ctx.control.skipNext) {
        ctx.control.skipNext = false;
        continue;
      }

      let ask: AskFn | undefined;
      if (options?.defaultAsk) {
        const sid = pendingInputSessionId
        ask = async (message?: string) => {
          await options.defaultAsk!(sid, message)
        }
      }

      let idempotencyDone = false;
      if (step.idempotencyGuard) {
        const guardRuntime = new EvixorRuntime(ctx, step.name, pendingInputSessionId, ask);
        const guardResult = await execUserFnReturn(sandbox, step.idempotencyGuard, guardRuntime);
        if (guardResult?.done) {
          idempotencyDone = true;
          if (guardResult.drop) {
            ctx.current.drop = guardResult.drop;
          }
        }
      }

      const start = performance.now();
      const inputBefore = ctx.current.feed;
      const referenceBefore = deepClone(ctx.reference);
      const warningsBefore = ctx.warnings.length;
      const errorsBefore = ctx.errors.length;

      if (limits.maxAttemptsPerStep >= 0) {
        const stepMax = step.retry?.maxAttempts
        if (stepMax != null && stepMax > limits.maxAttemptsPerStep) {
          ctx!.error({}, `Step "${step.name}" violates limitation: max attempts [${stepMax}] exceeds the maxAttemptsPerStep limit [${limits.maxAttemptsPerStep}].`, null, true);
          ctx.meta.lifecycleStatus = "error";
          break;
        }
      }

      if (idempotencyDone) {
        ctx.meta.attempt = 0;
      } else if (ctx.control.isParallel && Array.isArray(ctx.current.feed)) {
        if (limits.maxConcurrency === 0) {
          ctx!.error({}, `Step "${step.name}" violates limitation: Parallel steps are not allowed under the current limits configuration.`, null, true);
          ctx.meta.lifecycleStatus = "error";
          break;
        } else if (limits.maxConcurrency > 0 && ctx.current.feed.length > limits.maxConcurrency) {
          ctx!.error({}, `Step "${step.name}" violates limitation: Parallel step feed [${ctx.current.feed.length}] exceeds the maxConcurrency limit [${limits.maxConcurrency}].`, null, true);
          ctx.meta.lifecycleStatus = "error";
          break;
        } else {
          await runStepParallel(ctx, step, pendingInputSessionId, ask, sandbox);
        }
      } else {
        await runStepSingle(ctx, step, pendingInputSessionId, ask, sandbox);
      }

      const end = performance.now();

      await emit(ctx, persistLayer, "step-end", {
        stepIndex: i,
        stepName: step.name,
        attempt: ctx.meta.attempt,
        output: ctx.current.drop,
        reference: diffRef(referenceBefore, ctx.reference),
        warnings: ctx.warnings.slice(warningsBefore),
        errors: ctx.errors.slice(errorsBefore),
        durationMs: Math.round(end - start),
      } as StepEndEvent);

      if (ctx.errors.some((e) => e.fatal)) {
        ctx.meta.lifecycleStatus = "error";
      }

      if (isTerminated(ctx)) {
        break;
      }

      if (options?.simulateBroken?.(ctx.pipelineId.rootId, `run:step-end-beforesave:${i}`)) {
        simulatedCrash = true;
        break;
      }

      const shouldSave =
        item.type === "step" &&
        (step.idempotencyGuard ||
          (options?.saveCtxAfterSeconds != null &&
            options.saveCtxAfterSeconds > 0 &&
            (end - start) / 1000 > options.saveCtxAfterSeconds));

      if (shouldSave) {
        ctx.meta.stepIndex = i + 1;
        await persistLayer.saveCtx(ctx.pipelineId, ctx);
        if (options?.simulateBroken?.(ctx.pipelineId.rootId, `run:step-end-aftersave:${i}`)) {
          simulatedCrash = true;
          break;
        }
      }
    }

    if (!ctx.meta.lifecycleStatus) {
      ctx.meta.lifecycleStatus = "done";
    }
  }

  if (!simulatedCrash) {
    await runDiagnosticsIfNeeded(pipeline, ctx, sandbox);
    await runFinallyIfNeeded(pipeline, ctx, sandbox);
    await finalizePipeline(ctx, persistLayer);
  }

  await trackUsage(ctx, options, startIndex);
  return { drop: ctx.current.drop, context: ctx };
}

async function trackUsage(
  ctx: EvixorCtx,
  options: EvixorRunOptions | undefined,
  startIndex: number
) {
  await options?.onUsage?.({
    pipelineId: pipelineIdToString(ctx.pipelineId),
    pipeline: ctx.pipeline,
    stepsAdvanced: ctx.meta.stepIndex - startIndex,
  })
}
