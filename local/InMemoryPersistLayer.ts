/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import {
  PersistLayer,
} from "../persistLayer";

import {
  PipelineId,
  TimelineMeta,
  PendingInputEntry,
  SubpipelineReturnsEntry,
  InitPayload,
  EvixorRunOptions
} from "../types";

import { TimelineItem } from "../timelineEvents";
import { parsePipelineId, randomIdForDev, pipelineIdToString, zeroLastThreeDigits } from "../utilities";
import { createCtx, EvixorCtx, restoreCtx } from "../context";



export class InMemoryPersistLayer implements PersistLayer {

  private ctxStore = new Map<string, EvixorCtx>();
  private timelineStore = new Map<string, TimelineMeta>();
  private pendingInputsStore = new Map<string, PendingInputEntry[]>();
  private subpipelineReturnsStore = new Map<string, SubpipelineReturnsEntry[]>();
  private payloadStore = new Map<string, InitPayload>();

  async newPipelineId(pipeline: string, rootId?: string, parentCtx?: EvixorCtx): Promise<PipelineId> {
    return {
      rootId: rootId ?? randomIdForDev(),
      timestamp: Math.max(
        zeroLastThreeDigits(Date.now()),
        this.lastTimestamp
      ),
      pipeline: pipeline
    }
  }

  //
  // 1. Workflow Context
  //
  async saveCtx(pipelineId: PipelineId, ctx: EvixorCtx): Promise<void> {
    const key = pipelineIdToString(pipelineId);
    this.ctxStore.set(key, ctx);
  }

  async loadCtx(pipelineId: PipelineId, options?: EvixorRunOptions): Promise<EvixorCtx | null> {
    const key = pipelineIdToString(pipelineId);
    const ctx = this.ctxStore.get(key);
    if (ctx) {
      return ctx;
    }

    const payload = await this.loadPayload(key);
    if (!payload || payload.pipeline !== pipelineId.pipeline) {
      return null;
    }

    const ctxData = await createCtx({
      pipelineId: pipelineId,
      pipeline: pipelineId.pipeline,
      startTime: pipelineId.timestamp,
      payload: payload.payload,
      options
    });

    return ctxData;
  }

  async getWorkflowToActivate(rootId: string): Promise<PipelineId | null> {
    const keys: string[] = [];
    for (const key of this.payloadStore.keys()) {
      if (key.startsWith(rootId)) keys.push(key);
    }

    keys.sort((a, b) => parsePipelineId(b).timestamp - parsePipelineId(a).timestamp);

    for (let i = 0; i < keys.length; i++) {
      const ctx = this.ctxStore.get(keys[i]);
      const status = ctx?.meta.lifecycleStatus;
      if (!ctx || !status) {
        return parsePipelineId(keys[i]);
      }
      if (!["done", "abort", "timeout", "error", "doneWithContinue"].includes(status)) {
        return parsePipelineId(keys[i]);
      }
    }

    return null;
  }


  //
  // 2. Resume Lock (No-op in debug mode)
  //
  async acquireLock(rootId: string): Promise<string | null> {
    return "in-memory"; // always success
  }

  async refreshLock(rootId: string, ownerToken: string): Promise<boolean> {
    return true; // no-op
  }

  async releaseLock(rootId: string, ownerToken: string): Promise<boolean> {
    return false; // no-op
  }

  //
  // 3. Timeline
  private lastTimestamp = 0;
  async submitTimelineItem(ctx: EvixorCtx, item: TimelineItem): Promise<void> {
    const key = pipelineIdToString(ctx.pipelineId);
    let tm = this.timelineStore.get(key);
    if (!tm) {
      tm = { pipelineId: ctx.pipelineId, createdAt: Date.now(), items: [] };
      this.timelineStore.set(key, tm);
    }

    //item.timestamp = this.atom++;
    item.timestamp = Math.max(zeroLastThreeDigits(Date.now()), this.lastTimestamp + 1);
    this.lastTimestamp = item.timestamp;

    tm.items.push(item);
  }

  async getPipelineTimeline(pipelineId: string): Promise<TimelineMeta | undefined> {
    return this.timelineStore.get(pipelineId);
  }

  async markPipelineLifecycle(
    pipelineId: PipelineId,
    lifecycleStatus: "done" | "doneWithContinue" | "abort" | "timeout" | "error" | "pending"): Promise<void> {
    const key = pipelineIdToString(pipelineId);
    const tm = this.timelineStore.get(key);
    if (tm) {
      tm.lifecycleStatus = lifecycleStatus;
    }

    const ctx = this.ctxStore.get(key);
    if (ctx) {
      ctx.meta.lifecycleStatus = lifecycleStatus;
    }
  }

  //
  // 3.1 terminatePendingPipelines (as you defined)
  //
  async terminatePendingPipelines(
    rootId: string,
    lifecycleStatus: "error" | "timeout" | "abort"
  ): Promise<PipelineId[]> {

    const result: PipelineId[] = [];

    for (const [key, ctx] of this.ctxStore.entries()) {
      if (ctx.pipelineId.rootId === rootId &&
        ctx.meta.lifecycleStatus === "pending") {

        // Update ctx
        ctx.meta.lifecycleStatus = lifecycleStatus;

        // Mark timeline as ended
        const tm = this.timelineStore.get(key);
        if (tm) {
          tm.lifecycleStatus = lifecycleStatus;
        }

        result.push(ctx.pipelineId);
      }
    }

    return result;
  }

  //
  // 3.2 getPendingPipelineToResume
  //
  async getPendingPipelineToResume(rootId: string): Promise<PipelineId | null> {
    let latest: PipelineId | null = null;

    for (const ctx of this.ctxStore.values()) {
      if (ctx.pipelineId.rootId === rootId &&
        ctx.meta.lifecycleStatus === "pending") {

        if (!latest || ctx.pipelineId.timestamp > latest.timestamp) {
          latest = ctx.pipelineId;
        }
      }
    }

    return latest;
  }

  //
  // 3.3 getWorkflowTreeTimeline
  //
  async getWorkflowTreeTimeline(rootId: string): Promise<TimelineMeta[]> {
    const result: TimelineMeta[] = [];

    for (const [key, tm] of this.timelineStore.entries()) {
      if (tm.pipelineId.rootId === rootId) {
        result.push(tm);
      }
    }

    return result;
  }

  // async findPipeline(workflowId: string): Promise<TimelineMeta | undefined> {
  //   return this.timelineStore.get(workflowId);
  // }

  async listRootPipelines(): Promise<string[]/* bootstrap pipelineId */> {
    const result: PipelineId[] = [];
    Array.from(this.ctxStore.values()).map(ctx => {
      const found = result.find(r => r.rootId === ctx.pipelineId.rootId);
      if (found) {
        if (found.timestamp > ctx.pipelineId.timestamp) {
          found.pipeline = ctx.pipelineId.pipeline;
          found.timestamp = ctx.pipelineId.timestamp;
        }
      } else {
        result.push({
          rootId: ctx.pipelineId.rootId,
          pipeline: ctx.pipelineId.pipeline,
          timestamp: ctx.pipelineId.timestamp
        });
      }
    });
    return result.map(r => pipelineIdToString(r));
  }

  async listDoneWithContinueRootIds(): Promise<string[]> {
    const rootIds = new Set<string>();
    for (const ctx of this.ctxStore.values()) {
      if (ctx.meta.lifecycleStatus === "doneWithContinue") {
        rootIds.add(ctx.pipelineId.rootId);
      }
    }
    return Array.from(rootIds);
  }

  async listPendingSubpipelineParents(): Promise<{ rootId: string; parentPipelineId: string; childPipelineId: string }[]> {
    const result: { rootId: string; parentPipelineId: string; childPipelineId: string }[] = [];
    for (const ctx of this.ctxStore.values()) {
      const c = ctx.control.continue;
      if (
        ctx.meta.lifecycleStatus === "pending" &&
        c?.type === "subpipeline" &&
        c.pipelineId
      ) {
        result.push({
          rootId: ctx.pipelineId.rootId,
          parentPipelineId: pipelineIdToString(ctx.pipelineId),
          childPipelineId: c.pipelineId,
        });
      }
    }
    return result;
  }

  //
  // 4. PendingInput Queue
  //
  async enqueuePendingInputs(
    rootId: string,
    inputs: { sessionId: string; role: string; input: any }[]
  ): Promise<void> {
    const arr = this.pendingInputsStore.get(rootId) ?? [];
    const entries = inputs.map(i => ({ ...i, timestamp: Date.now() }));
    arr.push(...entries);
    this.pendingInputsStore.set(rootId, arr);
  }

  async dequeuePendingInputs(rootId: string): Promise<PendingInputEntry[] | null> {
    const arr = this.pendingInputsStore.get(rootId) ?? null;
    this.pendingInputsStore.delete(rootId);
    return arr;
  }

  async getPendingInputsSessionId(pipelineId: PipelineId): Promise<string> {
    const pids: PipelineId[] = [];

    for (const ctx of this.ctxStore.values()) {
      if (ctx.pipelineId.rootId === pipelineId.rootId) {
        pids.push(ctx.pipelineId);
      }
    }

    // Sorted in reverse order
    pids.sort((a, b) => b.timestamp - a.timestamp);

    let ts = pipelineId.timestamp;
    for (const p of pids) {
      if (p.pipeline === pipelineId.pipeline) {
        ts = p.timestamp;
      } else {
        break;
      }
    }

    return `${pipelineIdToString(pipelineId)}:${ts}`;
  }

  //
  // 5. Subpipeline Returns
  //
  async enqueueSubpipelineReturns(
    rootId: string,
    pipeline: string,
    drops: any[]
  ): Promise<void> {
    const arr = this.subpipelineReturnsStore.get(rootId) ?? [];
    arr.push({ pipeline, drops, timestamp: Date.now() });
    this.subpipelineReturnsStore.set(rootId, arr);
  }

  async dequeueSubpipelineReturns(
    rootId: string
  ): Promise<SubpipelineReturnsEntry | null> {
    const arr = this.subpipelineReturnsStore.get(rootId) ?? null;
    if (!arr || arr.length === 0) return null;

    const item = arr.shift()!;
    this.subpipelineReturnsStore.set(rootId, arr);
    return item;
  }

  //
  // 6. Payload
  //
  async savePayload(pipelineId: string, pipeline: string, payload: any, bootstrap: boolean): Promise<void> {
    this.payloadStore.set(pipelineId, { pipelineId: parsePipelineId(pipelineId), pipeline, payload });
  }

  async loadPayload(pipelineId: string): Promise<InitPayload | null> {
    return this.payloadStore.get(pipelineId) ?? null;
  }
}
