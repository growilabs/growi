import type { IncomingMessage } from 'node:http';
import type { Hono } from 'hono';

import type { Settings } from '../config/load-settings';
import type { ErrorCode } from '../contract';
import type { ConversionRunner, RunInput, RunOutcome } from '../runner';
import type { AppContext, AppEnv } from './app-env';
import { createConcurrencySlots } from './concurrency-slots';
import { errorAnswer } from './early-answer';
import { ERROR_TABLE } from './error-table';
import { extractResponse } from './extract-response';
import {
  boundaryOf,
  createMultipartParser,
  InvalidMultipart,
  type MultipartUpload,
} from './parse-multipart';
import {
  receiveUpload,
  UploadDisconnected,
  UploadTimeout,
  UploadTooLarge,
} from './receive-upload';
import {
  formatOf,
  type RequestFacts,
  type RequestLine,
  type RequestLog,
} from './request-log';

// POST /extract in the Python service's order (research.md 16.1): auth (the
// middleware) -> declared length -> slot, without waiting -> capped,
// deadlined body -> file size -> conversion in a child. The slot is released
// only once the runner has returned, i.e. its child is reaped.

export interface ExtractRouteDeps {
  readonly settings: Settings;
  readonly runner: ConversionRunner;
  readonly log: RequestLog;
}

const MIB = 1024 * 1024;
// Room for the multipart framing around the file (Python's MULTIPART_OVERHEAD_BYTES)
const FRAMING_BYTES = 64 * 1024;
// Node's own test for routing a request to 'checkContinue'
const CONTINUE = /(?:^|\W)100-continue(?:$|\W)/i;

const BUSY = 'Service is at maximum concurrency — try again later';
const INVALID =
  "The request must be a multipart/form-data body with one 'file' part";
const UPLOAD_TIMEOUT =
  'upload_timeout: the request body was not received in time';
const BODY_ENDED = 'client_disconnected: the request body ended early';
const ABANDONED =
  'client_disconnected: the client went away before the conversion finished';

interface Intake {
  readonly maxFileBytes: number;
  readonly maxBodyBytes: number;
  readonly timeoutMs: number;
  readonly bodyTooLarge: string;
}

const intakeOf = (settings: Settings): Intake => ({
  maxFileBytes: settings.maxFileSizeMb * MIB,
  maxBodyBytes: settings.maxFileSizeMb * MIB + FRAMING_BYTES,
  timeoutMs: settings.uploadTimeoutS * 1000,
  bodyTooLarge: `Request body exceeds the ${settings.maxFileSizeMb} MiB file size limit`,
});

interface Refusal {
  readonly result: string;
  readonly status: number;
  readonly code: ErrorCode;
  readonly message: string;
}

type Received =
  | { readonly ok: true; readonly input: RunInput }
  | { readonly ok: false; readonly refusal: Refusal };

const refused = (refusal: Refusal): Received => ({ ok: false, refusal });

/** Only an early refusal: the bytes that arrive are counted all the same. */
const declaredOverCap = (incoming: IncomingMessage, cap: number): boolean => {
  const declared = incoming.headers['content-length'];
  return (
    declared !== undefined && /^\d+$/.test(declared) && Number(declared) > cap
  );
};

const wantsContinue = (incoming: IncomingMessage): boolean =>
  incoming.httpVersion === '1.1' &&
  CONTINUE.test(incoming.headers.expect ?? '');

const refusalOf = (error: unknown, intake: Intake): Refusal => {
  if (error instanceof UploadTooLarge) {
    return {
      result: 'file_too_large',
      status: 413,
      code: 'file_too_large',
      message: intake.bodyTooLarge,
    };
  }
  if (error instanceof UploadTimeout) {
    return {
      result: 'upload_timeout',
      status: 408,
      code: 'extraction_timeout',
      message: UPLOAD_TIMEOUT,
    };
  }
  if (error instanceof InvalidMultipart) {
    return {
      result: 'invalid_upload',
      status: 422,
      code: 'extraction_failed',
      message: INVALID,
    };
  }
  if (error instanceof UploadDisconnected) {
    return {
      result: 'client_disconnected',
      status: 422,
      code: 'extraction_failed',
      message: BODY_ENDED,
    };
  }
  throw error;
};

// The file goes to the runner as the chunks it arrived in: joining them here
// would hold every upload twice (research.md 16.9).
const receiveFile = async (
  c: AppContext,
  intake: Intake,
): Promise<Received> => {
  const { incoming, outgoing } = c.env;
  let upload: MultipartUpload;
  try {
    const parser = createMultipartParser(
      boundaryOf(incoming.headers['content-type'] ?? ''),
    );
    if (wantsContinue(incoming)) outgoing.writeContinue();
    upload = await receiveUpload(incoming, parser, c.req.raw.signal, intake);
  } catch (error) {
    return refused(refusalOf(error, intake));
  }
  if (upload.size > intake.maxFileBytes) {
    return refused({
      result: 'file_too_large',
      status: 413,
      code: 'file_too_large',
      message: `File size ${upload.size} bytes exceeds the ${intake.maxFileBytes / MIB} MiB limit`,
    });
  }
  return {
    ok: true,
    input: {
      chunks: upload.chunks,
      size: upload.size,
      fileName: upload.filename,
      mimeHint: upload.mimeHint,
    },
  };
};

const errorName = (error: unknown): string =>
  error instanceof Error ? error.name : typeof error;

const convertAndAnswer = async (
  c: AppContext,
  { runner, log }: ExtractRouteDeps,
  input: RunInput,
  line: RequestLine,
): Promise<Response> => {
  const signal = c.req.raw.signal;
  const facts: RequestFacts = {
    format: formatOf(input.fileName),
    size: input.size,
  };
  let outcome: RunOutcome;
  try {
    outcome = await runner.run(input, signal);
  } catch (error) {
    log.error(
      `extract runner raised format=${facts.format} size=${facts.size} error=${errorName(error)}`,
    );
    outcome = {
      kind: 'failed',
      failure: 'internal',
      detail: '',
      childPeakRssMb: null,
    };
  }
  if (signal.aborted) {
    // Nobody is left to read it; the child is already stopped and reaped.
    line('client_disconnected', facts);
    return errorAnswer(c, 422, 'extraction_failed', ABANDONED);
  }
  if (outcome.kind === 'ok') {
    line('ok', {
      ...facts,
      format: outcome.mimeType,
      childPeakRssMb: outcome.childPeakRssMb,
    });
    return extractResponse(outcome.pages, outcome.mimeType);
  }
  line(outcome.failure, { ...facts, childPeakRssMb: outcome.childPeakRssMb });
  const { status, code, message } = ERROR_TABLE[outcome.failure];
  return errorAnswer(c, status, code, message);
};

export const registerExtractRoute = (
  app: Hono<AppEnv>,
  deps: ExtractRouteDeps,
): void => {
  const slots = createConcurrencySlots(deps.settings.maxConcurrency);
  const intake = intakeOf(deps.settings);
  app.post('/extract', async (c) => {
    const line = deps.log.start();
    if (declaredOverCap(c.env.incoming, intake.maxBodyBytes)) {
      line('file_too_large');
      return errorAnswer(c, 413, 'file_too_large', intake.bodyTooLarge);
    }
    const release = slots.tryAcquire();
    if (release === null) {
      line('service_busy');
      return errorAnswer(c, 503, 'service_busy', BUSY);
    }
    try {
      const received = await receiveFile(c, intake);
      if (!received.ok) {
        const { result, status, code, message } = received.refusal;
        line(result);
        return errorAnswer(c, status, code, message);
      }
      return await convertAndAnswer(c, deps, received.input, line);
    } finally {
      release();
    }
  });
};
