/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { PersistLayer } from "../persistLayer";
import {
  PendingInputsFn,
  SubpipelineCompletedFn,
  type DiagnosticsHandlerFn,
  type FinallyHandlerFn,
  type EvixorRunOptions,
  type NextFn,
  type PipelineItem,
  type StepConfig,
  type StepFn
} from "../types";

import { runPipeline } from "./run";

export type PipelineBuilderFn = (pl:EvixorPipeline) => EvixorPipeline;

export class EvixorPipeline {
  private items: PipelineItem[] = [];
  private diagnosticsHandler?: DiagnosticsHandlerFn;
  private finallyHandler?: FinallyHandlerFn;
  private timeout: number = 1; // Hour

  step(name: string, fn: StepFn, retry?: StepConfig["retry"], idempotencyGuard?: StepConfig["idempotencyGuard"]) {
    this.items.push({ type: "step", config: { name, fn, retry, idempotencyGuard } });
    return this;
  }

  next(fn: NextFn) {
    this.items.push({ type: "next", config: { fn } });
    return this;
  }

  pendingInputs(name: string, fn: PendingInputsFn) {
    this.items.push({ type: "pendingInputs", config: { name, fn } });
    return this;
  }

  subpipeline(pipeline: string, fn: SubpipelineCompletedFn) {
    this.items.push({ type: "subpipeline", config: { pipeline, fn } });
    return this;
  }

  diagnostics(fn: DiagnosticsHandlerFn) {
    this.diagnosticsHandler = fn;
    return this;
  }

  finally(fn: FinallyHandlerFn) {
    this.finallyHandler = fn;
    return this;
  }

  getItems() {
    return this.items;
  }

  getDiagnosticsHandler() {
    return this.diagnosticsHandler;
  }

  getFinallyHandler() {
    return this.finallyHandler;
  }

  setTimeOut(hours:number = 1){
    this.timeout = hours;
  }

  getTimeOut(): number {
    return this.timeout;
  }

  hasPendingInputStep(): boolean {
    return this.items.some(i => i.type === "pendingInputs");
  }

  async run(
    workflowId: string,
    pipeline: string,
    persistLayer: PersistLayer,
    options?: EvixorRunOptions
  ) {
    return runPipeline(workflowId, pipeline, this, persistLayer, options);
  }
}

export function createPipeline() {
  return new EvixorPipeline();
}
