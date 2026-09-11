/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { EvixorCtx } from "../context";
import { RetryStepError } from "../errors";
import { EvixorRuntime } from "../runtime";
import {
  type AskFn,
  type StepConfig
} from "../types";
import { execUserFn } from "../utilities";
import type { StepSandbox } from "../types";

export async function runStepSingle(
  ctx: EvixorCtx,
  step: StepConfig,
  pendingInputSessionId: string,
  ask?: AskFn,
  sandbox?: StepSandbox,
) {
  const maxAttempts = step.retry?.maxAttempts ?? 1;
  const backoffMs = step.retry?.backoffMs ?? 0;
  const classifyError =
    step.retry?.classifyError ?? ((err) => (err?.__isRetryStepError) ? "retry" : "fatal");

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    ctx.meta.attempt = attempt;

    const runtime = new EvixorRuntime(ctx, step.name, pendingInputSessionId, ask);
    try {
      ctx.current.drop = [];
      await execUserFn(sandbox, step.fn, runtime);
      return;
    } catch (err) {
      const kind = classifyError(err);

      if (kind === "warn") {
        runtime.warn({}, `Step "${step.name}" warning on attempt ${attempt}`, err);
        return;
      }

      if (kind === "fatal") {
        runtime.error({}, `Step "${step.name}" failed fatally on attempt ${attempt}`, err, true);
        ctx.meta.lifecycleStatus = "abort";
        return;
      }

      runtime.warn({}, `Step "${step.name}" failed on attempt ${attempt}, will retry`, err);

      if (attempt < maxAttempts && backoffMs > 0) {
        await new Promise(r => setTimeout(r, backoffMs));
      }
    }
  }
}
