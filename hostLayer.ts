/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { EvixorCtx } from "./context";
import { EvixorPipeline } from "./pipeline/EvixorPipeline";
import { PipelineId } from "./types";

export interface HostLayerLite {
  /**
   * Request the Queue/Worker framework to start a pipeline instance.
   * workflowId is a string format, not a WorkflowId object.
   */
  queuePipeline(rootId: string, pipeline?: string): Promise<void>;
}

export interface HostLayerFull extends HostLayerLite {
  /**
   * Load EvixorPipeline by pipeline name (build only, no execution).
   */
  loadPipeline(pipeline: string): EvixorPipeline;
}
