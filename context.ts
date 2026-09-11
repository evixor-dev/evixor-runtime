/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import {
  EvixorCurrent,
  EvixorWarning,
  EvixorError,
  EvixorControl,
  EvixorMeta,
  EvixorState,
  EvixorRunOptions,
  PipelineId
} from "./types";
import { mergeRef, parsePipelineId, pipelineIdToString } from "./utilities";
import { mockableFetch } from "./fetch";
import { serializeError } from "./serializeError";
import { EvixorMock } from "./mocks";
import { EvixorRecorder } from "./recorders";

export interface EvixorCtxData {
  // Read-only fields (assigned at creation, immutable thereafter)
  readonly pipelineId: PipelineId;
  readonly pipeline: string;
  readonly startTime: number;

  // Internal writable fields (updated at runtime)
  meta: EvixorMeta;

  // User readable/writable fields
  payload: any;
  reference: any;
  state: EvixorState;
  current: EvixorCurrent;
  warnings: EvixorWarning[];
  errors: EvixorError[];
  control: EvixorControl;
}

export interface EvixorCtxFunctions {
  addReference: (ref: Record<string, string | string[]>) => void;
  warn: (
    ref: Record<string, string | string[]>,
    message: string,
    detail?: any
  ) => void;
  error: (
    ref: Record<string, string | string[]>,
    message: string,
    detail?: any,
    fatal?: boolean
  ) => void;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  markLifecycle: (status: "done" | "doneWithContinue" | "abort" | "timeout" | "error" | "pending") => void;
}

export interface EvixorCtx extends EvixorCtxData, EvixorCtxFunctions {
  mock?: EvixorMock;
  recorder?: EvixorRecorder;
}

export async function createCtx(initial: {
  pipelineId: PipelineId;
  pipeline: string;
  startTime: number;
  payload: any;
  options?: EvixorRunOptions;
}): Promise<EvixorCtx> {
  const strPipelineId = pipelineIdToString(initial.pipelineId);
  const ctx: EvixorCtx = {
    pipeline: initial.pipeline,
    pipelineId: initial.pipelineId,
    startTime: initial.startTime,

    payload: initial.payload,
    reference: { myPipelineId: [strPipelineId] },

    state: {},

    current: { feed: [], drop: [] },
    warnings: [],
    errors: [],
    control: { isParallel: false, skipNext: false },
    meta: { stepIndex: 0, stepName: undefined, attempt: 0 },

    addReference(ref: Record<string, string | string[]>) {
      mergeRef(this.reference, ref);
    },

    // Built-in warn
    warn(ref, message, detail) {
      // 1. Write to warnings
      ctx.warnings.push({
        step: ctx.meta.stepName ?? "",
        message,
        detail: serializeError(detail),
      });

      // 2. Merge reference
      if (ref)
        mergeRef(this.reference, ref);
    },

    // Built-in error
    error(ref, message, detail, fatal = false) {
      // 1. Write to errors
      ctx.errors.push({
        step: ctx.meta.stepName ?? "",
        message,
        detail: serializeError(detail),
        fatal,
      });

      // 2. Merge reference
      if (ref)
        mergeRef(this.reference, ref);
    },

    // // Built-in fetch (mockable + recordable)
    fetch: (url, init) => mockableFetch(ctx, url, init),

    markLifecycle(status) {
      ctx.meta.lifecycleStatus = status;
    },

    mock: initial.options?.mock,
    recorder: initial.options?.recorder,
  };

  return ctx;
}

export function restoreCtx(
  data: EvixorCtxData,
  options?: EvixorRunOptions
): EvixorCtx {
  const ctx: EvixorCtx = {
    ...data,
    addReference(ref: Record<string, string | string[]>) {
      mergeRef(this.reference, ref);
    },

    // Built-in warn
    warn(ref, message, detail) {
      // 1. Write to warnings
      ctx.warnings.push({
        step: ctx.meta.stepName ?? "",
        message,
        detail: serializeError(detail),
      });

      // 2. Merge reference
      if (ref)
        mergeRef(this.reference, ref);
    },

    // Built-in error
    error(ref, message, detail, fatal = false) {
      // 1. Write to errors
      ctx.errors.push({
        step: ctx.meta.stepName ?? "",
        message,
        detail: serializeError(detail),
        fatal,
      });

      // 2. Merge reference
      if (ref)
        mergeRef(this.reference, ref);
    },

    // // Built-in fetch (mockable + recordable)
    fetch: (url, init) => mockableFetch(ctx, url, init),

    markLifecycle(status) {
      ctx.meta.lifecycleStatus = status;
    },

    mock: options?.mock,
    recorder: options?.recorder,
  };

  return ctx;
}

export function forkCtxForParallelItem(
  parent: EvixorCtx,
  item: any
): EvixorCtx {
  const ctx: EvixorCtx = {
    pipeline: parent.pipeline,
    pipelineId: parent.pipelineId,
    startTime: parent.startTime,

    payload: parent.payload,

    // Reference cannot be shared
    reference: {},

    // -----------------------------
    // Shared references (correct)
    // -----------------------------
    state: parent.state,
    control: parent.control,

    // -----------------------------
    // Independent copies (must be independent)
    // -----------------------------
    warnings: [],
    errors: [],

    meta: {
      ...parent.meta,
      attempt: 0,
    },

    current: {
      feed: item,
      drop: [],
    },

    // -----------------------------
    // Behavior functions (shared)
    // -----------------------------
    addReference: parent.addReference,
    warn: parent.warn,
    error: parent.error,
    fetch: parent.fetch,
    markLifecycle: parent.markLifecycle,

    mock: parent.mock,
    recorder: parent.recorder,
  };

  return ctx;
}

// ============================================================
// 4. User Agent Context
// ============================================================

/**
 * User-visible context interface
 * Access restricted via Proxy
 */
export interface EvixorCtxUserView {
  readonly pipelineId: PipelineId;
  readonly pipeline: string;
  readonly startTime: number;
  readonly meta: Readonly<EvixorMeta>;

  payload: any;
  reference: Record<string, string | string[]>;
  state: EvixorState;
  current: EvixorCurrent;
  warnings: EvixorWarning[];
  errors: EvixorError[];
  control: EvixorControl;

  addReference: (ref: Record<string, string | string[]>) => void;
  warn: (
    ref: Record<string, string | string[]>,
    message: string,
    detail?: any
  ) => void;
  error: (
    ref: Record<string, string | string[]>,
    message: string,
    detail?: any,
    fatal?: boolean
  ) => void;
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
  markLifecycle: (status: "done" | "doneWithContinue" | "abort" | "timeout" | "error" | "pending") => void;
}

// ============================================================
// 5. Readonly property definitions (for user agent)
// ============================================================

// Always readonly fields (assigned at creation, immutable thereafter)
const READONLY_PROPERTIES = new Set<keyof EvixorCtxData>([
  'pipelineId',
  'pipeline',
  'startTime',
]);

// User readonly but internally writable fields
const USER_READONLY_PROPERTIES = new Set<keyof EvixorCtxData>([
  'meta',
]);

/**
 * Serialize context
 * Extract data only, remove functions
 */
export function serializeCtx(ctx: EvixorCtx): EvixorCtxData {
  return structuredClone(ctx);
}

// ============================================================
// 7. Create proxied context (restrict user access)
// ============================================================

/**
 * Create user-visible proxied context from full internal context
 * Expose only EvixorCtxData fields and EvixorCtxFunctions methods
 * mock/recorder excluded, inaccessible to user code
 */
export function createProxiedCtx(ctx: EvixorCtx): EvixorCtxUserView {
  const ctxData: EvixorCtxData = {
    pipelineId: ctx.pipelineId,
    pipeline: ctx.pipeline,
    startTime: ctx.startTime,
    payload: ctx.payload,
    reference: ctx.reference,
    state: ctx.state,
    current: ctx.current,
    warnings: ctx.warnings,
    errors: ctx.errors,
    control: ctx.control,
    meta: ctx.meta,
  };

  const functions: EvixorCtxFunctions = {
    addReference: ctx.addReference,
    warn: ctx.warn,
    error: ctx.error,
    fetch: ctx.fetch,
    markLifecycle: ctx.markLifecycle,
  };

  return new Proxy({} as EvixorCtxUserView, {
    get(target, prop: string | symbol, receiver) {
      // Get from functions
      if (prop in functions) {
        return Reflect.get(functions, prop, functions);
      }
      
      // Readonly property check
      if (READONLY_PROPERTIES.has(prop as keyof EvixorCtxData)) {
        return Reflect.get(ctxData, prop, ctxData);
      }
      
      // Deep readonly check: meta
      if (prop === 'meta') {
        return new Proxy(ctxData.meta, {
          get(target, subProp, receiver) {
            return Reflect.get(target, subProp, target);
          },
          set(_target, subProp) {
            throw new Error(`Cannot modify readonly property: meta.${String(subProp)}`);
          },
          deleteProperty(_target, subProp) {
            throw new Error(`Cannot delete readonly property: meta.${String(subProp)}`);
          },
        });
      }

      // Writable property
      return Reflect.get(ctxData, prop, ctxData);
    },

    set(target, prop: string | symbol, value, receiver) {
      // Always readonly property check
      if (READONLY_PROPERTIES.has(prop as keyof EvixorCtxData)) {
        throw new Error(`Cannot modify readonly property: ${String(prop)}`);
      }
      // User readonly property check
      if (USER_READONLY_PROPERTIES.has(prop as keyof EvixorCtxData)) {
        throw new Error(`Cannot modify readonly property: ${String(prop)}`);
      }
      // Write state to original ctx, ensure later createProxiedCtx can read
      if (prop === "state") {
        (ctx as unknown as Record<string, unknown>)[prop] = value;
      }
      return Reflect.set(ctxData, prop, value, ctxData);
    },

    deleteProperty(target, prop: string | symbol) {
      // Always readonly property check
      if (READONLY_PROPERTIES.has(prop as keyof EvixorCtxData)) {
        throw new Error(`Cannot delete readonly property: ${String(prop)}`);
      }
      // User readonly property check
      if (USER_READONLY_PROPERTIES.has(prop as keyof EvixorCtxData)) {
        throw new Error(`Cannot delete readonly property: ${String(prop)}`);
      }
      return Reflect.deleteProperty(ctxData, prop);
    },

    ownKeys(target) {
      const dataKeys = Reflect.ownKeys(ctxData);
      const functionKeys = Reflect.ownKeys(functions);
      return [...new Set([...dataKeys, ...functionKeys])];
    },

    getOwnPropertyDescriptor(target, prop) {
      if (prop in functions) {
        return { enumerable: true, configurable: true, get: () => Reflect.get(functions, prop, functions) };
      }
      if (READONLY_PROPERTIES.has(prop as keyof EvixorCtxData) || USER_READONLY_PROPERTIES.has(prop as keyof EvixorCtxData)) {
        return { enumerable: true, configurable: false, get: () => Reflect.get(ctxData, prop, ctxData) };
      }
      return {
        enumerable: true,
        configurable: true,
        get: () => Reflect.get(ctxData, prop, ctxData),
        set: (value: any) => {
          if (READONLY_PROPERTIES.has(prop as keyof EvixorCtxData) || USER_READONLY_PROPERTIES.has(prop as keyof EvixorCtxData)) {
            throw new Error(`Cannot modify readonly property: ${String(prop)}`);
          }
          return Reflect.set(ctxData, prop, value, ctxData);
        },
      };
    },
  }) as EvixorCtxUserView;
}
