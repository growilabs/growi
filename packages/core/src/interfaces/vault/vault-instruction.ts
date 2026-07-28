/** Supported operations that can be issued to vault-manager via vault_instructions. */
export type VaultInstructionOp =
  | 'upsert'
  | 'bulk-upsert'
  | 'remove'
  | 'rename-prefix'
  | 'grant-change-prefix'
  | 'reset-all';

/** A vault namespace string. Format: 'public' | 'restricted-link' | `group-${string}` | `user-${string}-only-me` */
export type Namespace = string;

/** A single entry in a bulk-upsert instruction. */
export interface VaultBulkUpsertEntry {
  readonly pageId: string;
  readonly pagePath: string;
  readonly revisionId: string;
}

/**
 * Payload embedded inside a VaultInstructionDoc.
 * namespace is optional — undefined when op === 'reset-all'.
 * All other fields are optional and op-dependent.
 */
export interface VaultInstructionPayload {
  readonly namespace?: Namespace;
  readonly pageId?: string;
  readonly pagePath?: string;
  readonly revisionId?: string;
  readonly entries?: ReadonlyArray<VaultBulkUpsertEntry>;
  readonly oldPrefix?: string;
  readonly newPrefix?: string;
  readonly fromNamespace?: Namespace;
}

/** A document stored in the vault_instructions collection. op is a top-level field, not inside payload. */
export interface VaultInstructionDoc {
  readonly _id: string;
  readonly op: VaultInstructionOp;
  readonly payload: VaultInstructionPayload;
  readonly issuedAt: Date;
  readonly processedAt: Date | null;
  readonly attempts: number;
  readonly lastError: string | null;
}
