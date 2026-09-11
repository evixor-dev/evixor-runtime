/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { EvixorCtx } from "./context";
import { PendingInputsRecordEntry, SubpipelineReturnsRecordEntry } from "./recorders";

export type MockFetchFn = (
  ctx: EvixorCtx,
  url: string,
  init?: RequestInit
) => Response | Promise<Response> | undefined;

export type MockPendingInputsFn = (ctx: EvixorCtx) => Promise<PendingInputsRecordEntry> | null;
export type MockSubpipelineReturnsFn = (ctx: EvixorCtx) => Promise<SubpipelineReturnsRecordEntry> | null;

export interface EvixorMock {
  mockFetch?: MockFetchFn;
  mockPendingInput?: MockPendingInputsFn;
  mockSubpipelineReturn?: MockSubpipelineReturnsFn;
}
