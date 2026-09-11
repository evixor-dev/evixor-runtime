/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { EvixorCtx } from "./context";
import { PendingInputEntry, SubpipelineReturnsEntry } from "./types";

export interface FetchRecordEntry {
  stepIndex: number;
  stepName?: string;
  attempt?: number;

  url: string;
  method: string;

  requestBody?: any;

  status: number,

  // Store as text directly, binary as base64
  responseBody: string;

  // Used to restore MIME during replay
  contentType: string;

  timestamp: number;
}

export interface PendingInputsRecordEntry {
  stepIndex: number;

  inputs: PendingInputEntry[];

  timestamp: number;
}

export interface SubpipelineReturnsRecordEntry {
  stepIndex: number;

  returns: SubpipelineReturnsEntry;

  timestamp: number;
}

export type NeedRecord = (ctx: EvixorCtx) => boolean;
export type FetchRecorder = (workflowId: string, entry: FetchRecordEntry) => Promise<void>;
export type PendingInputRecorder = (workflowId: string, entry: PendingInputsRecordEntry) => Promise<void>;
export type SubpipelineReturnRecorder = (workflowId: string, entry: SubpipelineReturnsRecordEntry) => Promise<void>;

export interface EvixorRecorder {
  needRecord?: NeedRecord;
  fetchRecorder?: FetchRecorder;
  pendingInputRecorder?: PendingInputRecorder;
  subpipelineReturnRecorder?: SubpipelineReturnRecorder;
}