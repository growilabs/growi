import { z } from 'zod';

import type { PageInfo } from '../contract';
import { ERROR_CODES } from '../contract/error-code';

// The request and answer schemas the OpenAPI document is generated from
// (research.md 17.13). Only `.meta({ id })` names a shared schema; every other
// name is the generator's default (Req 7.1, 7.6).

export const ErrorCodeSchema = z.enum(ERROR_CODES).meta({ id: 'ErrorCode' });

export const ErrorResponseSchema = z
  .object({ code: ErrorCodeSchema, message: z.string() })
  .meta({ id: 'ErrorResponse' });

export const PageInfoSchema = z
  .object({
    pageNumber: z.int().nullable(),
    label: z.string().nullable(),
    content: z.string(),
  })
  .meta({ id: 'PageInfo' });

export const ExtractResponseSchema = z
  .object({
    pages: z.array(PageInfoSchema),
    mimeType: z.string(),
    extractedCharacters: z.int(),
  })
  .meta({ id: 'ExtractResponse' });

/** Documentation only: the route reads the body itself (parse-multipart.ts). */
export const ExtractRequestSchema = z.object({
  file: z.file(),
  mimeType: z.string().optional(),
});

export const HealthSchema = z.object({ status: z.literal('ok') });

export const ReadySchema = z.object({
  status: z.literal('ready'),
  dependencies: z.record(z.string(), z.literal('ok')),
});

export const NotReadySchema = z.object({ status: z.literal('not_ready') });

export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;

// contract/ cannot import zod (the child imports contract/), so the two
// definitions of a page are held together by the compiler: a field added,
// dropped, made optional or retyped on either side fails here.
type Same<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2
    ? true
    : false;
true satisfies Same<Readonly<z.infer<typeof PageInfoSchema>>, PageInfo>;
