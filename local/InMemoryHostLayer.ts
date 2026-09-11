/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { HostLayerFull } from "../hostLayer";
import { PersistLayer } from "../persistLayer";
import { createPipeline, EvixorPipeline, PipelineBuilderFn } from "../pipeline/EvixorPipeline";
import { EvixorRunOptions, PipelineId } from "../types";
import { parsePipelineId, pendingInputSessionIdToString, randomIdForDev, zeroLastThreeDigits } from "../utilities";
import { receivePendingInputs, signalWorkflow } from "../workflowOrchestrator";


export class InMemoryHostLayer implements HostLayerFull {
  private map: Map<string, PipelineBuilderFn>;
  private persistLayer: PersistLayer;
  private queuedWorkflowParam: { rootId: string; } | null = null;

  constructor(persistLayer: PersistLayer, map: Map<string, PipelineBuilderFn>) {
    this.map = map;
    this.persistLayer = persistLayer;
  }

  loadPipeline(pipeline: string): EvixorPipeline {
    const pl = createPipeline();
    const builder = this.map.get(pipeline);
    if (builder) {
      return builder(pl);
    }

    throw new Error(`unknown pipeline: ${pipeline}`);
  }

  async queuePipeline(rootId: string, pipeline?: string): Promise<void> {
    this.queuedWorkflowParam = { rootId };
  }

  async doLoop(
    options?: EvixorRunOptions,
    readLine?: (question: string) => Promise<string>
  ) {
    while (this.queuedWorkflowParam) {
      const currentParam = this.queuedWorkflowParam;
      this.queuedWorkflowParam = null;
      //const jsonWid = parseWorkflowId(currentParam.workflowId);

      const t = await signalWorkflow(currentParam.rootId, this.persistLayer, this, options);
      if (t === "pending") {
        const pid = await this.persistLayer.getWorkflowToActivate(currentParam.rootId);
        if(!pid) break;
        if (readLine) {
          const answer = await readLine(`Please answer the question: `);

          const sessionId = pendingInputSessionIdToString({
            rootId: pid.rootId,
            pipeline: pid.pipeline,
            timestamp: pid.timestamp,
            firstRunTimestamp: pid.timestamp,
          });
          await receivePendingInputs(
            currentParam.rootId,
            pid.pipeline,
            [{
              sessionId,
              role: "unknown",
              input: answer,
            }],
            this.persistLayer,
            this);
        } else {
          break;
        }
      }
    }
  }
}