/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { EvixorCtx, EvixorCtxUserView } from "./context";
import type { PendingInputSessionId, StepSandbox, PipelineId } from "./types";

export async function execUserFn<T extends (...args: any[]) => any>(
  sandbox: StepSandbox | undefined,
  fn: T,
  ...args: Parameters<T>
): Promise<void> {
  if (sandbox) {
    await sandbox.run(fn, ...args);
  } else {
    await fn(...args);
  }
}

export async function execUserFnReturn<T extends (...args: any[]) => any>(
  sandbox: StepSandbox | undefined,
  fn: T,
  ...args: Parameters<T>
): Promise<Awaited<ReturnType<T>>> {
  if (sandbox) {
    let result: Awaited<ReturnType<T>>;
    await sandbox.run(async (...r: Parameters<T>) => {
      result = await fn(...r);
    }, ...args);
    return result!;
  }
  return await fn(...args);
}

export function deepClone<T>(obj: T): T {
  if (typeof structuredClone === "function") {
    return structuredClone(obj);
  }
  return JSON.parse(JSON.stringify(obj));
}

export function mergeRef(target: any, ref: Record<string, string | string[]>) {
  for (const key of Object.keys(ref)) {
    const value = ref[key];
    const arr = Array.isArray(value) ? value : [value];

    if (!Array.isArray(target[key])) {
      target[key] = [];
    }

    for (const id of arr) {
      if (!target[key].includes(id)) {
        target[key].push(id);
      }
    }
  }
}

export function diffRef(
  before: Record<string, string[] | string> | any,
  after: Record<string, string[] | string> | any
) {
  const added: Record<string, string[]> = {};

  for (const key of Object.keys(after)) {
    const beforeVal = before[key];
    const afterVal = after[key];

    // Normalize to array
    const beforeArr = Array.isArray(beforeVal)
      ? beforeVal
      : beforeVal != null
        ? [beforeVal]
        : [];

    const afterArr = Array.isArray(afterVal)
      ? afterVal
      : afterVal != null
        ? [afterVal]
        : [];

    // Compute diff set
    const diff = afterArr.filter(id => !beforeArr.includes(id));

    if (diff.length > 0) {
      added[key] = diff;
    }
  }

  return added;
}

export function pipelineIdToString(id: PipelineId): string {
  return `${id.rootId}:${id.timestamp}:${id.pipeline}`;
}

export function parsePipelineId(str: string): PipelineId {
  const [rootId, timestampStr, pipeline] = str.split(":");
  return {
    rootId,
    timestamp: Number(timestampStr),
    pipeline,
  };
}

export function isExpiredByHours(start: number, hours: number): boolean {
  const now = Date.now();
  const expireAt = start + hours * 3600 * 1000;
  return now >= expireAt;
}


export interface ShrinkOptions {
  maxStringLength?: number;   // Max string length per field
  maxArrayLength?: number;    // Max array length
  maxObjectKeys?: number;     // Max object key count
  maxDepth?: number;          // Max recursion depth
}

const defaultOptions: Required<ShrinkOptions> = {
  maxStringLength: 200,
  maxArrayLength: 20,
  maxObjectKeys: 20,
  maxDepth: 4,
};

export function shrinkValueDeep(
  value: any,
  options: ShrinkOptions = {}
): any {
  const opt = { ...defaultOptions, ...options };

  function helper(val: any, depth: number): any {
    if (depth > opt.maxDepth) {
      return { __type: typeof val, __note: "maxDepth exceeded" };
    }

    if (val === null || val === undefined) return val;

    // Primitive type
    if (typeof val === "string") {
      if (val.length > opt.maxStringLength) {
        return val.slice(0, opt.maxStringLength) + "...(truncated)";
      }
      return val;
    }

    if (typeof val === "number" || typeof val === "boolean") {
      return val;
    }

    // Array
    if (Array.isArray(val)) {
      if (val.length > opt.maxArrayLength) {
        return {
          __type: "array",
          length: val.length,
          sample: val.slice(0, opt.maxArrayLength).map((v) => helper(v, depth + 1)),
          __note: "array truncated",
        };
      }
      return val.map((v) => helper(v, depth + 1));
    }

    // Object
    if (typeof val === "object") {
      const keys = Object.keys(val);

      if (keys.length > opt.maxObjectKeys) {
        return {
          __type: "object",
          keys: keys.slice(0, opt.maxObjectKeys),
          __note: "object keys truncated",
        };
      }

      const result: any = {};
      for (const k of keys) {
        result[k] = helper(val[k], depth + 1);
      }
      return result;
    }

    return { __type: typeof val };
  }

  return helper(value, 0);
}

export function pendingInputSessionIdToString(id: PendingInputSessionId): string {
  return `${id.rootId}:${id.timestamp}:${id.pipeline}:${id.firstRunTimestamp}`;
}

export function parsePendingInputSessionId(str: string): PendingInputSessionId {
  const [rootId, timestampStr, pipeline, firstRunTimestampStr] = str.split(":");

  return {
    rootId,
    timestamp: Number(timestampStr),
    pipeline,
    firstRunTimestamp: Number(firstRunTimestampStr),
  };
}

export function defaultPendingInputSessionPolicy(pipelineSessionId: string, inputSessionId: string) {
  const pId = parsePendingInputSessionId(pipelineSessionId);
  const iId = parsePendingInputSessionId(inputSessionId);
  return pId.timestamp === iId.timestamp // Strict check, mainly for debugging convenience
    || pId.firstRunTimestamp === iId.firstRunTimestamp;
}

export function randomIdForDev() {
  return Math.random().toString(36).substring(2, 12);
}

export function zeroLastThreeDigits(num: number): number {
  return num - (num % 1000);
}

export function isPending(ctx: EvixorCtx): boolean {
  return ctx.meta.lifecycleStatus === "pending";
}

export function isTerminated(ctx: EvixorCtx): boolean {
  return ctx.meta.lifecycleStatus === "done"
    || ctx.meta.lifecycleStatus === "doneWithContinue"
    || ctx.meta.lifecycleStatus === "abort"
    || ctx.meta.lifecycleStatus === "timeout"
    || ctx.meta.lifecycleStatus === "error";
}
