/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { EvixorCtx, forkCtxForParallelItem } from "../context";
import { RetryStepError } from "../errors";
import { EvixorRuntime } from "../runtime";
import { type AskFn, type StepConfig } from "../types";
import { execUserFn } from "../utilities";
import type { StepSandbox } from "../types";

export async function runStepParallel(
  ctx: EvixorCtx,
  step: StepConfig,
  pendingInputSessionId: string,
  ask?: AskFn,
  sandbox?: StepSandbox,
) {
  const feed = ctx.current.feed;
  ctx.current.drop = [];

  const maxAttempts = step.retry?.maxAttempts ?? 1;
  const backoffMs = step.retry?.backoffMs ?? 0;
  const classifyError = step.retry?.classifyError ?? ((err) => (err?.__isRetryStepError) ? "retry" : "fatal");

  await Promise.all(
    feed.map(async (item: any, index: number) => {
      const localCtx = forkCtxForParallelItem(ctx, item);

      for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        localCtx.meta.attempt = attempt;
        const runtime = new EvixorRuntime(
          localCtx,
          step.name,
          pendingInputSessionId,
          ask
        );

        try {
          await execUserFn(sandbox, step.fn, runtime);

          // -----------------------------
          // Merge reference / warnings / errors / drop
          // -----------------------------

          // 1. reference: use addReference
          if (localCtx.reference) {
            ctx.addReference(localCtx.reference);
          }

          // 2. warnings: merge one by one
          for (const w of localCtx.warnings) {
            ctx.warnings.push(w);
          }

          // 3. errors: merge one by one
          for (const e of localCtx.errors) {
            ctx.errors.push(e);
          }

          // 4. drop: merge
          ctx.current.drop.push(...localCtx.current.drop);

          return;
        } catch (err) {
          const kind = classifyError(err);

          if (kind === "warn") {
            runtime.warn(
              {},
              `Step "${step.name}" warning on attempt ${attempt} (index ${index})`,
              err
            );
            return;
          }

          if (kind === "fatal") {
            runtime.error(
              {},
              `Step "${step.name}" failed fatally on attempt ${attempt} (index ${index})`,
              err,
              true
            );
            ctx.meta.lifecycleStatus = "abort";
            return;
          }

          runtime.warn(
            {},
            `Step "${step.name}" failed on attempt ${attempt} (index ${index}), will retry`,
            err
          );

          if (attempt < maxAttempts && backoffMs > 0) {
            await new Promise((r) => setTimeout(r, backoffMs));
          }
        }
      }
    })
  );
}
