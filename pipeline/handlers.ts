/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { EvixorCtx, createProxiedCtx } from "../context";
import { EvixorPipeline } from "./EvixorPipeline";
import { execUserFn } from "../utilities";
import type { StepSandbox } from "../types";

export async function runDiagnosticsIfNeeded(pipeline: EvixorPipeline, ctx: EvixorCtx, sandbox?: StepSandbox) {
  const hasIssues =
    (ctx.errors && ctx.errors.length > 0) ||
    (ctx.warnings && ctx.warnings.length > 0);

  if (!hasIssues) return;

  ctx.meta.stepIndex = pipeline.getItems().length;
  ctx.meta.stepName = "(diagnostics)";

  const handler = pipeline.getDiagnosticsHandler();
  if (!handler) return;

  try {
    await execUserFn(sandbox, handler, createProxiedCtx(ctx));
  } catch (err) {
    ctx.warnings.push({
      step: "(diagnostics)",
      message: "onDiagnostics handler threw an exception",
      detail: err,
    });
  }
}

export async function runFinallyIfNeeded(pipeline: EvixorPipeline, ctx: EvixorCtx, sandbox?: StepSandbox) {
  const handler = pipeline.getFinallyHandler();
  if (!handler) return;

  ctx.meta.stepIndex = pipeline.getItems().length;
  ctx.meta.stepName = "(finally)";

  try {
    await execUserFn(sandbox, handler, createProxiedCtx(ctx));
  } catch (err) {
    ctx.errors.push({
      step: "(finally)",
      message: "finally handler failed",
      detail: err,
      fatal: false,
    });
  }
}
