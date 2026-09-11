/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

import { EvixorCtx } from "./context";
import { DevError, OpsError, RetryableError } from "./errors";
import { pipelineIdToString } from "./utilities";

export async function mockableFetch(
  ctx: EvixorCtx,
  url: string,
  init?: RequestInit
): Promise<Response> {

  // 1. mockFetch takes priority
  if (ctx.mock?.mockFetch) {
    try {
      const mockRes = await ctx.mock?.mockFetch(ctx, url, init);
      if (mockRes) return mockRes;
    } catch (err) {
      ctx.error({}, "mockFetch failed", err);
    }
  }

  // 2. Real fetch
  try {
    const method = init?.method ?? "GET";
    const requestBody = extractBody(init?.body);

    const res = await fetch(url, init);

    // Read content-type
    const contentType = res.headers.get("content-type") || "";

    let raw: string | ArrayBuffer;
    let responseBody: string;

    if (contentType.startsWith("application/json") || contentType.startsWith("text/")) {
      // Text
      raw = await res.text();
      responseBody = raw; // Store text directly
    } else {
      // Binary type
      const buf = await res.arrayBuffer();
      raw = buf;
      responseBody = arrayBufferToBase64(buf); // Store as base64
    }

    // 3. Record fetch (only record real fetches)
    if (ctx.recorder?.fetchRecorder
      && (ctx.recorder?.needRecord?.(ctx) ?? true)) {
      await ctx.recorder.fetchRecorder?.(
        pipelineIdToString(ctx.pipelineId),
        {
          stepIndex: ctx.meta.stepIndex,
          stepName: ctx.meta.stepName,
          attempt: ctx.meta.attempt,
          url,
          method,
          requestBody,
          status: res.status,
          responseBody,
          contentType,
          timestamp: Date.now(),
        });
    }

    // 4. Return new Response (avoid consuming original response)
    return new Response(raw, {
      status: res.status,
      headers: res.headers,
    });


  } catch (err) {
    ctx.error({}, "fetch failed", err, true);
    throw err;
  }
}

function extractBody(body: any) {
  if (!body) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();

  try {
    return JSON.stringify(body);
  } catch {
    return "[unserializable body]";
  }
}

function arrayBufferToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function fetchJson<T>(
  runtime: { fetch: (url: string, init?: RequestInit) => Promise<Response> },
  url: string,
  init?: RequestInit,
  timeoutMs = 15000
): Promise<T> {
  const controller = new AbortController();
  const id = setTimeout(() => controller.abort(), timeoutMs);

  let res: Response;

  // --- Network error (retryable) ---
  try {
    res = await runtime.fetch(url, { ...init, signal: controller.signal });
  } catch (err) {
    clearTimeout(id);
    throw new RetryableError(
      `Network error while fetching ${url}: ${String(err)}`,
      { url }
    );
  }

  clearTimeout(id);

  const status = res.status;

  // --- HTTP status classification ---
  if (!res.ok) {
    const raw = await res.text().catch(() => "");

    // 400 series are typically dev errors
    if (status >= 400 && status < 500) {
      throw new DevError(`HTTP ${status} for ${url}: ${raw}`, {
        url,
        status,
        raw,
      });
    }

    // 429 / 503 could be either recoverable or ops issue
    if (status === 429 || status === 503) {
      // Simple strategy: short response body → recoverable; long-term failure → ops
      if (raw.includes("rate limit") || raw.includes("busy")) {
        throw new RetryableError(`Temporary ${status} for ${url}`, {
          url,
          status,
          raw,
        });
      } else {
        throw new OpsError(`Service unavailable ${status} for ${url}`, {
          url,
          status,
          raw,
        });
      }
    }

    // 500 series → ops error
    if (status >= 500) {
      throw new OpsError(`Server error ${status} for ${url}: ${raw}`, {
        url,
        status,
        raw,
      });
    }
  }

  // --- Content-Type check ---
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const raw = await res.text().catch(() => "");
    throw new DevError(
      `Expected JSON from ${url}, got: ${contentType}. Raw: ${raw}`,
      { url, status, raw }
    );
  }

  // --- JSON parsing ---
  try {
    return (await res.json()) as T;
  } catch (err) {
    const raw = await res.text().catch(() => "");
    throw new DevError(
      `Invalid JSON response from ${url}. Raw: ${raw}`,
      { url, status, raw }
    );
  }
}
