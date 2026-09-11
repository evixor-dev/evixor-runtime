/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { EvixorCtx } from "./context";
import { TimelineItem } from "./timelineEvents";
import {
  PipelineId,
  TimelineMeta,
  PendingInputEntry,
  SubpipelineReturnsEntry,
  InitPayload,
  EvixorRunOptions
} from "./types";

/**
 * PersistLayer
 * 
 * Evixor's sole "platform boundary layer":
 * - All persistence
 * - All resume states
 * - All pendingInputs / subpipeline returns
 * - All timeline
 * - All payload
 * 
 * Notes:
 * - rootId is always a string (external format)
 * - WorkflowId is always JSON (internal format)
 */
export interface PersistLayer {

  /**
   * Create a new PipelineId.
   * If rootId exists, it means creating a subpipeline / reRun / subpipeline instance.
   */
  newPipelineId(pipeline: string, rootId?: string, parentCtx?: EvixorCtx): Promise<PipelineId>;

  //
  // 1. Workflow Context (core: resume)
  //

  /** Save current pipeline context (ctx) */
  saveCtx(pipelineId: PipelineId, ctx: EvixorCtx): Promise<void>;

  /**
   * Load pipeline context (ctx).
   *
   * Timeline status contract (for stateful implementations like SQLite):
   * - submitTimelineItem writes status='pending' (uncommitted buffer)
   * - saveCtx promotes that workflow's pending to 'submitted' (commit confirmation)
   * - loadCtx before resuming a workflow marks its stale pending as 'discard'
   *   (crash-uncommitted traces, re-emitted on re-run).
   */
  loadCtx(pipelineId: PipelineId, options?: EvixorRunOptions): Promise<EvixorCtx | null>;

  getWorkflowToActivate(rootId: string): Promise<PipelineId | null>;

  //
  // 2. Resume Lock (core: single-instance semantics)
  //

  /** Acquire rootId resume lock (ensures only one pipeline executes per rootId). Returns ownerToken on success, null on failure */
  acquireLock(rootId: string): Promise<string | null>;

  /** Refresh rootId resume lock (ownerToken must match; mismatch returns false = lock lost/stolen) */
  refreshLock(rootId: string, ownerToken: string): Promise<boolean>;

  /** Release resume lock (ownerToken must match). Returns whether missedEvent occurred */
  releaseLock(rootId: string, ownerToken: string): Promise<boolean>;


  //
  // 3. Timeline (core: event sourcing + debug + nested structure)
  //

  /** Append a timeline item */
  submitTimelineItem(
    ctx: EvixorCtx,
    item: TimelineItem
  ): Promise<void>;

  //
  // 3.1 Timeline query
  //

  listRootPipelines(): Promise<string[]/* root pipeline pipelineId */>;

  /** List timeline for a pipeline */
  getPipelineTimeline(pipelineId: string): Promise<TimelineMeta | undefined>;

  /** Find all pipelines (main + sub) under rootId, for UI display */
  getWorkflowTreeTimeline(rootId: string): Promise<TimelineMeta[]>;

  /**
   * Mark pipeline lifecycle status (done / doneWithContinue / abort / timeout / error / pending).
   * - doneWithContinue: pipeline completed (treated as done), but its sequel (reRun/nextPipeline or child)
   *   has not been created yet. The only difference is that getWorkflowToActivate will treat it as
   *   activatable (newest priority) to trigger sequel reconstruction.
   */
  markPipelineLifecycle(pipelineId: PipelineId, lifecycleStatus: "done" | "doneWithContinue" | "abort" | "timeout" | "error" | "pending"): Promise<void>;

  /**
   * Propagate lifecycleStatus from child pipeline to all pending parent pipelines.
   * Used for subpipeline fatal / timeout / abort upstream broadcast.
   * TODO: design still has issues
   */
  terminatePendingPipelines(
    rootId: string,
    lifecycleStatus: "done" | "error" | "timeout" | "abort"
  ): Promise<PipelineId[]>;


  /** Find the "latest incomplete" pipeline under rootId, for resume */
  getPendingPipelineToResume(rootId: string): Promise<PipelineId | null>;

  //
  // 3.2 Recovery scan (full scan on startup/heartbeat, fix millisecond crash window)
  //

  /** List all root pipelines with lifecycleStatus='doneWithContinue' (sequel may not be created, needs reconstruction) */
  listDoneWithContinueRootIds(): Promise<string[]>;

  /** List all pending pipelines where continue.subpipeline.pipelineId already exists (child built; if parent payload missing then child killed; if child done then returns lost) */
  listPendingSubpipelineParents(): Promise<{ rootId: string; parentPipelineId: string; childPipelineId: string }[]>;




  //
  // 4. PendingInput Queue (core: multi-input convergence)
  //

  /** Enqueue pendingInputs (may be inputs from multiple roles) */
  enqueuePendingInputs(
    rootId: string,
    inputs: { sessionId: string, role: string; input: any }[]
  ): Promise<void>;

  /** Dequeue pendingInputs (used for pendingInputs-step resume) */
  dequeuePendingInputs(rootId: string): Promise<PendingInputEntry[] | null>;

  getPendingInputsSessionId(pipelineId: PipelineId): Promise<string>;


  //
  // 5. Subpipeline Returns (core: child pipeline resume)
  //

  /** Enqueue child pipeline returns (drops) */
  enqueueSubpipelineReturns(
    rootId: string,
    pipeline: string,
    drops: any[]
  ): Promise<void>;

  /** Dequeue child pipeline returns*/
  dequeueSubpipelineReturns(
    rootId: string
  ): Promise<SubpipelineReturnsEntry | null>;


  //
  // 6. Payload (core: queuePipeline and worker payload)
  //

  /**
   * Save payload during queuePipeline.
   * Worker gets workflowId and calls loadPayload to retrieve full payload.
   */
  savePayload(workflowId: string, pipeline: string, payload: any, bootstrap: boolean): Promise<void>;

  /** Load payload (used for worker to start pipeline) */
  loadPayload(workflowId: string): Promise<InitPayload | null>;
}
