/*
 * Copyright © 2026 Evixor.
 * Licensed under the MIT License.
 */

// errors.ts

export interface HttpErrorMeta {
  url: string;
  status?: number;
  raw?: string;
}

export abstract class BaseHttpError extends Error {
  constructor(
    message: string,
    public meta: HttpErrorMeta,
    public retryable: boolean,
    public opsRequired: boolean,
    public devRequired: boolean
  ) {
    super(message);
  }
}

/**
 * 1. Errors requiring dev intervention (non-recoverable)
 *    - JSON parse failure
 *    - Non-JSON response
 *    - 400 Bad Request
 *    - UnexpectedResponseError
 */
export class DevError extends BaseHttpError {
  constructor(message: string, meta: HttpErrorMeta) {
    super(message, meta, false, false, true);
  }
}

/**
 * 2. Errors requiring ops intervention (non-recoverable)
 *    - AI token exhausted
 *    - Server overload (503)
 *    - Service down
 *    - Persistent 429
 */
export class OpsError extends BaseHttpError {
  constructor(message: string, meta: HttpErrorMeta) {
    super(message, meta, false, true, false);
  }
}

/**
 * 3. Recoverable errors (retryable)
 *    - Network error
 *    - DNS flapping
 *    - fetch throws exception
 *    - Timeout
 *    - Temporary 429 / 503
 */
export class RetryableError extends BaseHttpError {
  constructor(message: string, meta: HttpErrorMeta) {
    super(message, meta, true, false, false);
  }
}

export class RetryStepError extends Error {
  readonly __isRetryStepError = true
  constructor(message: string){
    super(message)
    this.name = "RetryStepError"
  }
}
