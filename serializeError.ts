/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

// serializeError.ts

export interface SerializedError {
  name?: string;
  message?: string;
  stack?: string;
  cause?: any;
  [key: string]: any;
}

export function serializeError(err: any): SerializedError {
  // null / undefined / primitive
  if (err === null || err === undefined) return { message: String(err) };
  if (typeof err !== "object") return { message: String(err) };

  // Already serialized
  if (isSerializedError(err)) return err;

  const out: SerializedError = {};

  // Standard Error fields
  if (err instanceof Error) {
    out.name = err.name;
    out.message = err.message;
    out.stack = err.stack;

    // Node.js Error cause
    if ((err as any).cause) {
      out.cause = serializeError((err as any).cause);
    }
  }

  // Copy enumerable fields (Error may have custom fields)
  for (const key of Object.keys(err)) {
    try {
      const value = (err as any)[key];
      out[key] = safeSerializeValue(value);
    } catch {
      out[key] = "[unserializable]";
    }
  }

  return out;
}

// -----------------------------
// Helpers
// -----------------------------

function isSerializedError(obj: any): obj is SerializedError {
  return (
    obj &&
    typeof obj === "object" &&
    ("message" in obj || "stack" in obj || "name" in obj)
  );
}

function safeSerializeValue(value: any): any {
  if (value === null || value === undefined) return value;

  const t = typeof value;

  if (t === "string" || t === "number" || t === "boolean") return value;

  if (t === "bigint") return value.toString();

  if (t === "function") return `[function ${value.name || "anonymous"}]`;

  if (value instanceof Error) return serializeError(value);

  // Avoid circular references
  try {
    JSON.stringify(value);
    return value;
  } catch {
    return "[circular]";
  }
}
