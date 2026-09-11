/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { EvixorCtx, EvixorCtxUserView } from "./context";

export function resetControl(ctx: EvixorCtx): void {
  ctx.control = { isParallel: false, skipNext: false };
}

function controlSubpipeline(ctx: EvixorCtxUserView, pipeline: string) {
  ctx.control.continue = {
    type: "subpipeline",
    pipeline,
  };
  ctx.markLifecycle("pending");
}

export function controlReRun(ctx: EvixorCtxUserView, reason?: string): void {
  ctx.markLifecycle("doneWithContinue");
  ctx.control.continue = { type: "reRun", reason };
}

export function controlNextPipeline(ctx: EvixorCtxUserView, pipeline: string, reason?: string): void {
  ctx.markLifecycle("doneWithContinue");
  ctx.control.continue = { type: "nextPipeline", pipeline, reason };
}

export function controlDone(ctx: EvixorCtxUserView) {
  ctx.markLifecycle("done");
}

export function controlAbort(ctx: EvixorCtxUserView) {
  ctx.markLifecycle("abort");
}
