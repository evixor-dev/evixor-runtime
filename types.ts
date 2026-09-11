/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { EvixorCtxUserView } from "./context";
import { EvixorMock } from "./mocks";
import { EvixorRecorder } from "./recorders";
import { TimelineItem } from "./timelineEvents";

export type EvixorState = Record<string, any>;

export interface EvixorCurrent {
  feed: any;       // Current step's input (feed/drop pairing: feed in, drop out)
  drop: any[];     // Current step collected output
}

export interface EvixorWarning {
  step: string;
  message: string;
  detail?: any;
}

export interface EvixorError {
  step: string;
  message: string;
  detail?: any;
  fatal: boolean;
}

/**
 * ContinueDirective.
 * Determines how the next pipeline executes after the current pipeline ends.
 * 
 * - subpipeline: suspend current pipeline, start child pipeline, wait for its return
 * - nextPipeline: end current pipeline, start another pipeline
 * - reRun: end current pipeline, restart the same pipeline
 */
export type ContinueDirective = 
  | { type: "subpipeline"; pipeline: string; pipelineId?: string }
  | { type: "nextPipeline"; pipeline: string; reason?: string; pipelineId?: string }
  | { type: "reRun"; reason?: string; pipelineId?: string };

export interface EvixorControl {
  isParallel: boolean;   // Is next step parallel?
  skipNext: boolean;     // Skip next step?

  continue?: ContinueDirective;
}

export interface EvixorMeta {
  lifecycleStatus?: "done" | "doneWithContinue" | "abort" | "timeout" | "error" | "pending";
  stepIndex: number;
  stepName?: string;
  attempt?: number;
}

export interface EvixorRuntimeApi {
  getPayload<T = any>(): T;
  getFeed<T = any>(): T;
  submitDrop(value: any): void;
  addReference: (ref: Record<string, string | string[]>) => void;
  warn(ref: Record<string, string | string[]>, message: string, detail?: any): void;
  error(ref: Record<string, string | string[]>, message: string, detail?: any, fatal?: boolean): void;

  fetch(url: string, init?: RequestInit): Promise<Response>;

  createInputRequest(role: string, question: any): InputRequest;

  ask?: AskFn;
}

export type StepFn = (pl: EvixorRuntimeApi) => Promise<void> | void;
export type NextFn = (ctx: EvixorCtxUserView) => void;
export type DiagnosticsHandlerFn = (ctx: EvixorCtxUserView) => Promise<void> | void;
export type FinallyHandlerFn = (ctx: EvixorCtxUserView) => Promise<void> | void;

export interface RetryConfig {
  maxAttempts: number;          // Max retry attempts (including first)
  backoffMs?: number;           // Wait between retries
  classifyError?: (err: any) => "retry" | "fatal" | "warn";
}

export interface IdempotencyCheckResult {
  done: boolean;
  drop?: any[];
}

export interface StepConfig {
  name: string;
  fn: StepFn;
  idempotencyGuard?: (pl: EvixorRuntimeApi) => Promise<IdempotencyCheckResult | void> | IdempotencyCheckResult | void;
  retry?: RetryConfig;
}

export interface NextConfig {
  fn: NextFn;
}

export interface PendingInputsConfig {
  name: string;
  fn: PendingInputsFn;
}

export interface SubpipelineConfig {
  pipeline: string;
  fn: SubpipelineCompletedFn;
}

export type PipelineItem =
  | { type: "step"; config: StepConfig }
  | { type: "next"; config: NextConfig }
  | { type: "pendingInputs"; config: PendingInputsConfig }
  | { type: "subpipeline"; config: SubpipelineConfig };

  // time out returns false
export type PendingInputSessionPolicyFn = (pipelineSessionId: string, inputSessionId: string) => boolean;

export type AskFn = (message?: string) => Promise<void>;

export interface UsageInfo {
  pipelineId: string;
  pipeline: string;
  stepsAdvanced: number;
}

export interface EvixorLimits{
  maxConcurrency: number;
  maxFetchPerStep: number;
  maxAttemptsPerStep: number;
  maxStepsPerPipeline: number;
}

export const defaultLimits: Required<EvixorLimits> = {
  maxConcurrency: -1,
  maxFetchPerStep: -1,
  maxAttemptsPerStep: -1,
  maxStepsPerPipeline: -1,
};

export interface StepSandbox {
  run<T extends (...args: any[]) => any>(fn: T, ...args: Parameters<T>): Promise<void>;
}

export interface EvixorRunOptions {
  recorder?: EvixorRecorder;
  mock?: EvixorMock;
  pendingInputSessionPolicy?: PendingInputSessionPolicyFn;

  /**
   * Optional: function to yield the event loop.
   * - CLI debug mode: use setImmediate or Promise.resolve
   * - Cloudflare Worker: typically not provided (no need to yield)
   */
  yieldEventLoop?: () => Promise<void>;

  onUsage?: (info: UsageInfo) => void | Promise<void>;

  defaultAsk?: (sessionId: string, message?: string) => Promise<void>;

  limits?: Partial<EvixorLimits>;

  sandbox?: StepSandbox;

  /**
   * Internal use: current execution's owner token.
   * Injected after signalWorkflow's acquireLock succeeds, for refreshLock/releaseLock ownership verification.
   * Host / user code should not set this.
   */
  lockOwnerToken?: string;

  /**
   * Optional: trigger saveCtx when step execution exceeds this many seconds, for long step crash protection.
   * Empty or <= 0 does not trigger.
   */
  saveCtxAfterSeconds?: number;

  /**
   * Dev/test: called at crash checkpoints. Return true to stop workflow progression.
   * `name` identifies the checkpoint for per-point probability control.
   */
  simulateBroken?: (rootId: string, name: string) => boolean;

  // log?: (msg:string) => void;
}

export interface PipelineId {
  rootId: string;      // Root id of the entire pipeline
  timestamp: number;   // Pipeline instance creation time
  pipeline: string;    // Pipeline name
}

export interface TimelineMeta {
  pipelineId: PipelineId;
  createdAt: number;
  lifecycleStatus?: string;
  items: TimelineItem[];
}

export type PendingInputsFn = (ctx: EvixorCtxUserView, inputs: PendingInputEntry[]) => void;

export type SubpipelineCompletedFn = (ctx: EvixorCtxUserView, returns: SubpipelineReturnsEntry) => void;

export interface SubpipelineReturnsEntry {
  pipeline: string;
  drops: any[];
  timestamp: number;
}

export interface InitPayload {
  pipelineId: PipelineId;
  pipeline: string;
  payload: any;
}

export interface InputRequest {
  sessionId: string;
  role: string;
  question: any;
}

export interface PendingInputEntry {
  sessionId: string;
  role: string;
  input: any;
  timestamp: number;
}

export interface PendingInputSessionId {
  rootId: string;      // Root id of the entire workflow
  timestamp: number;   // Pipeline instance creation time
  pipeline: string;    // Pipeline name
  firstRunTimestamp: number;
}
