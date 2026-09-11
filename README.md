# @evixor/evixor-runtime

**Evixor Runtime** is a lightweight, embeddable workflow engine for orchestrating multi-step pipelines with retries, parallel execution, subpipelines, and human-in-the-loop interactions.

Check out a working demo on GitHub: https://github.com/evixor-dev/workflow-demo
Try it live at: https://evixor.org

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Overview

`@evixor/evixor-runtime` is the core runtime of Evixor. It executes pipeline definitions written as TypeScript/JavaScript functions, managing state, control flow, and persistence through pluggable host and storage layers.

## Installation

```bash
npm install @evixor/evixor-runtime
```

## Key Concepts

### Pipeline

A pipeline is a sequence of named steps. Each step receives a runtime API object (`EvixorRuntimeApi`) for accessing payload, input, and emitting output. Steps can run serially or in parallel.

### Context (`EvixorCtx`)

The context carries workflow state through execution: current input/output, metadata (step index, lifecycle status), control directives (parallel, skip, continue), warnings, and errors.

### Control Flow

Built-in directives (`resetControl`, `controlSubpipeline`, `controlReRun`, `controlNextPipeline`, `controlDone`, `controlAbort`) let step code determine what happens next — branching to another pipeline, rerunning, or terminating.

### Persistence & Hosting

The runtime is environment-agnostic. You provide:
- A **`PersistLayer`** — stores context, payload, timeline, and pending inputs
- A **`HostLayer`** — loads pipeline definitions and queues signals

Built-in implementations: `InMemoryPersistLayer` and `InMemoryHostLayer` for local dev/testing.

## Usage

```ts
import {
  EvixorRuntime,
  EvixorPipeline,
  createPipeline,
  InMemoryPersistLayer,
  InMemoryHostLayer,
} from "@evixor/evixor-runtime"

const pipeline: EvixorPipeline = createPipeline({
  name: "my-pipeline",
  steps: [
    { name: "step1", fn: async (pl) => { /* ... */ } },
    { name: "step2", fn: async (pl) => { /* ... */ } },
  ],
})

const runtime = new EvixorRuntime(pipeline, persistLayer, hostLayer)
const result = await runtime.run(payload)
```

## Main Exports

| Export | Description |
|--------|-------------|
| `EvixorRuntime` | Pipeline runner |
| `EvixorPipeline`, `createPipeline` | Pipeline definition |
| `EvixorCtx`, `EvixorCtxUserView`, `EvixorCtxData` | Context types |
| `createCtx`, `restoreCtx`, `createProxiedCtx` | Context utilities |
| `StepFn`, `NextFn` | Step and next handler signatures |
| `RetryConfig`, `RetryStepError` | Step retry mechanism |
| `BaseHttpError`, `DevError`, `OpsError`, `RetryableError` | Typed error hierarchy |
| `HostLayerLite`, `HostLayerFull` | Host layer interfaces |
| `PersistLayer` | Persistence layer interface |
| `signalWorkflow`, `startWorkflow`, `rerunWorkflow`, `resumeWorkflow`, `receivePendingInputs` | Workflow orchestration |
| `resetControl`, `controlSubpipeline`, `controlReRun`, `controlNextPipeline`, `controlDone`, `controlAbort` | User-space control flow helpers |
| `fetchJson` | Typed fetch wrapper |
| `TimelineItem`, `TimelineEventType`, `TimelineEventData` and event subtypes | Timeline types |
| `EvixorRecorder`, `FetchRecordEntry`, `PendingInputsRecordEntry`, `SubpipelineReturnsRecordEntry` | Recording interfaces |
| `InMemoryPersistLayer`, `InMemoryHostLayer` | In-memory implementations for testing |

## License

MIT License. See [LICENSE](LICENSE) file for details.
