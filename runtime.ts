/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { EvixorCtxUserView } from "./context";
import type { AskFn, EvixorRuntimeApi, InputRequest } from "./types";

export class EvixorRuntime implements EvixorRuntimeApi {
  private ctxUV: EvixorCtxUserView;
  private stepName: string;
  private sessionId: string;

  constructor(
    ctx: EvixorCtxUserView,
    stepName: string,
    sessionId: string,
    ask?: AskFn
  ) {
    this.ctxUV = ctx;
    this.stepName = stepName;
    this.sessionId = sessionId;
    this.ask = ask;
  }

  // -----------------------------
  // State Access
  // -----------------------------
  getPayload<T = any>(): T {
    return this.ctxUV.payload as T;
  }

  getFeed<T = any>(): T {
    return this.ctxUV.current.feed as T;
  }

  addReference(ref: Record<string, string | string[]>){
    this.ctxUV.addReference(ref);
  }

  // -----------------------------
  // Drop Output
  // -----------------------------
  submitDrop(value: any) {
    this.ctxUV.current.drop.push(value);
  }

  createInputRequest(role: string, question: any): InputRequest {
    return {
      sessionId: this.sessionId,
      role,
      question,
    };
  }

  ask?: AskFn;

  // -----------------------------
  // Logging
  // -----------------------------
  warn = (ref: Record<string, string | string[]>, message: string, detail?: any) => {
    this.ctxUV.warn(ref, message, detail);
  };

  error = (
    ref: Record<string, string | string[]>,
    message: string,
    detail?: any,
    fatal = false
  ) => {
    this.ctxUV.error(ref, message, detail, fatal);
  };

  // -----------------------------
  // HTTP Fetch (Mockable)
  // -----------------------------
  fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    return this.ctxUV.fetch(url, init);
  }
}
