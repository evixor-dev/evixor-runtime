/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { PipelineId, PendingInputEntry, SubpipelineReturnsEntry } from "./types";
import { shrinkValueDeep } from "./utilities";

/**
 * TimelineItem: unified event format
 */
export interface TimelineItem {
  //eventId?: string;            // Unique event ID (optional)
  pipelineId: PipelineId;     // Owning pipeline
  timestamp: number;          // Event timestamp
  type: TimelineEventType;    // Event type
  data: TimelineEventData;    // Event data (varies by type)
}

/**
 * All event types
 */
export type TimelineEventType =
  | "pipeline-start"
  | "pipeline-end"
  | "pipeline-pending"
  | "pipeline-resume"

  | "step-start"
  | "step-end"

  | "next-step"
  | "next-end"

  | "pending-inputs-wait"
  | "pending-inputs-resume"
  | "pending-inputs-return"

  | "subpipeline-start"
  | "subpipeline-wait"
  | "subpipeline-resume"
  | "subpipeline-return"

  | "rerun"
  | "next-pipeline"

  | "warning"
  | "error";

/**
 * Union type of all event data
 */
export type TimelineEventData =
  | PipelineStartEvent
  | PipelineEndEvent
  | PipelinePendingEvent
  | PipelineResumeEvent

  | StepStartEvent
  | StepEndEvent

  | NextStepEvent
  | NextEndEvent

  | PendingInputsWaitEvent
  | PendingInputsResumeEvent

  | SubpipelineStartEvent
  | SubpipelineWaitEvent
  | SubpipelineResumeEvent
  | SubpipelineReturnEvent

  | RerunEvent
  | NextPipelineEvent

  | WarningEvent
  | ErrorEvent;

/* ---------------- Pipeline-level events ---------------- */

export interface PipelineStartEvent {
  pipeline: string;
  payload: any;
}

export interface PipelineEndEvent {
  pipeline: string;
  lifecycleStatus: string; // done/error/abort/timeout
  drop?: any[];
  reference: any;
  warnings: any[];
  errors: any[];
}

export interface PipelinePendingEvent {
  reason: "pendingInputs" | "subpipeline";
}

export interface PipelineResumeEvent {
  fromStepIndex: number;
}

/* ---------------- Step-level events ---------------- */

export interface StepStartEvent {
  stepIndex: number;
  stepName: string;
  feed: any;
}

export interface StepEndEvent {
  stepIndex: number;
  stepName: string;
  attempt: number;
  output: any[];
  reference: any;
  warnings: any[];
  errors: any[];
  durationMs: number;
}

/* ---------------- next-step ---------------- */

export interface NextStepEvent {
  stepIndex: number;
  output: any[];
}

export interface NextEndEvent {
  stepIndex: number;
  stepName: string;
  feed: any[];
  reference: any;
  warnings: any[];
  errors: any[];
  durationMs: number;
}

/* ---------------- pendingInputs ---------------- */

export interface PendingInputsWaitEvent {
  stepName: string;
  stepIndex: number;
}

export interface PendingInputsResumeEvent {
  stepName: string;
  stepIndex: number;
}

export interface PendingInputsReturnEvent {
  stepName: string;
  stepIndex: number;
  inputs: PendingInputEntry[];
}

/* ---------------- subpipeline ---------------- */

export interface SubpipelineStartEvent {
  stepIndex: number;
  pipeline: string;
  childPipelineId: string;
  payload: any;
}

export interface SubpipelineWaitEvent {
  stepIndex: number;
  pipeline: string;
}

export interface SubpipelineResumeEvent {
  stepIndex: number;
  pipeline: string;
}

export interface SubpipelineReturnEvent {
  stepIndex: number;
  pipeline: string;
  drop: any[];
}

/* ---------------- reRun / nextPipeline ---------------- */

export interface RerunEvent {
  reason: string;
  payload: any;
}

export interface NextPipelineEvent {
  pipeline: string;
  reason?: string;
  payload: any;
}

/* ---------------- runtime warning / error ---------------- */

export interface WarningEvent {
  stepIndex: number;
  message: string;
  detail?: any;
}

export interface ErrorEvent {
  stepIndex: number;
  message: string;
  detail?: any;
  fatal: boolean;
}

/**
 * Reference implementation
 async submitTimelineItem(workflowId: WorkflowId, item: TimelineItem): Promise<void> {
  const level = this.timelineRedactionLevel ?? 1;
  if (level > 0) {
    item.data = shrinkTimelineData(item.data, level);
  }
  await this.db.insert(item);
}
 */
export function shrinkTimelineData(data: any, level: number) {
  if (!data) return data;

  const clone = { ...data };

  const shrinkOptions =
    level === 1
      ? { maxStringLength: 200, maxArrayLength: 20, maxObjectKeys: 20 }
      : { maxStringLength: 50, maxArrayLength: 5, maxObjectKeys: 5 };

  for (const key of ["input", "output", "payload", "drop"]) {
    if (key in clone) {
      clone[key] = shrinkValueDeep(clone[key], shrinkOptions);
    }
  }

  return clone;
}
