// What these tests pin down is the pair of properties task 5.2 exists for:
//
//  1. a key is MINTED and STORED in the same act as the pairing that needs it,
//     through the very `DbClient` handle the caller supplied -- which is what
//     lets `PairingService` (task 5.4) build this service over the `tx` of its
//     own `$transaction` and get the `relation` row and the `own_key` row
//     committed or rolled back together;
//  2. what leaves this layer is the MEANS to sign (a `KeyObject`), never a
//     decrypted PEM (design.md 9.6 / 「復号は `own-key-repository` の中だけ」).
//
// The cipher below is a plain reversible fake rather than real authenticated
// encryption. That is honest here and not a weakened test: encrypting at rest
// is `own-key-repository`'s contract, and `own-key-repository.spec.ts` already
// proves it against a real AES-256-GCM cipher. This service never sees a
// ciphertext; it only has to hand the repository the PEM.
import {
  createPublicKey,
  generateKeyPairSync,
  type KeyObject,
} from 'node:crypto';
import {
  isValidKeyIdShape,
  isValidPublicKeyMaterial,
  type SignParams,
} from '@growi/chat/server';
import { type DeepMockProxy, mockDeep } from 'vitest-mock-extended';

import type { PrismaClient } from '../db/index.js';
import type { SecretCipher } from '../types/index.js';
import type {
  KeyDeliveryOutcome,
  SendKeyRegistration,
  SendKeyRevocation,
} from './relation-key-service.js';
import { createRelationKeyService } from './relation-key-service.js';

const PREFIX = 'plain:';
const fakeCipher: SecretCipher = {
  encrypt: (plaintext) => `${PREFIX}${plaintext}`,
  decrypt: (ciphertext) => ciphertext.slice(PREFIX.length),
};

const NOW = new Date('2026-06-01T00:00:00.000Z');

const ownKeyRow = (overrides: Record<string, unknown> = {}) => ({
  id: 'own-key-row-1',
  relationId: 'relation-1',
  keyId: 'proxy-key-1',
  privateKeyPem: '',
  validFrom: new Date('2026-01-01T00:00:00.000Z'),
  revokedAt: null,
  supersededKeyId: null,
  deliveredToPeerAt: null,
  ...overrides,
});

// `listKeys` selects a subset of columns, but the mocked delegate is typed
// against the whole row -- so a listing fixture is just a row.
const rowForListing = ownKeyRow;

const serviceOver = (prisma: PrismaClient, keyId = 'proxy-key-1') =>
  createRelationKeyService({
    db: prisma,
    cipher: fakeCipher,
    generateKeyId: () => keyId,
    now: () => NOW,
  });

describe('relationKeyService.issue (Requirement 9.5)', () => {
  it('writes the key through the very handle it was given, so a caller can scope it to its own transaction', async () => {
    // The same-transaction property design.md requires is structural: this
    // service never reaches for a client of its own, it writes through the
    // `DbClient` it was constructed with. A second service built over another
    // handle must therefore leave the first handle untouched.
    const tx = mockDeep<PrismaClient>();
    const other = mockDeep<PrismaClient>();
    tx.ownKey.create.mockResolvedValue(ownKeyRow());
    other.ownKey.create.mockResolvedValue(ownKeyRow());

    await serviceOver(tx).issue('relation-1');
    await serviceOver(other, 'other-key').issue('relation-2');

    expect(tx.ownKey.create).toHaveBeenCalledTimes(1);
    expect(other.ownKey.create).toHaveBeenCalledTimes(1);
    expect(tx.ownKey.create.mock.calls[0][0].data).toMatchObject({
      relationId: 'relation-1',
      keyId: 'proxy-key-1',
      validFrom: NOW,
      supersededKeyId: null,
    });
  });

  it('mints a fresh Ed25519 private key and stores it, never returning it', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.create.mockResolvedValue(ownKeyRow());

    const result = await serviceOver(prisma).issue('relation-1');

    const storedPem = fakeCipher.decrypt(
      prisma.ownKey.create.mock.calls[0][0].data.privateKeyPem as string,
    );
    expect(storedPem).toContain('BEGIN PRIVATE KEY');
    expect(createPublicKey(storedPem).asymmetricKeyType).toBe('ed25519');

    expect(Object.keys(result).sort()).toEqual(['keyId', 'publicKeyJwk']);
    expect(JSON.stringify(result)).not.toContain('PRIVATE KEY');
    expect(JSON.stringify(result)).not.toContain(storedPem);
  });

  it('returns the public half of the key it stored, in the form the peer accepts', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.create.mockResolvedValue(ownKeyRow());

    const { publicKeyJwk } = await serviceOver(prisma).issue('relation-1');

    // The peer's own registration gate, not a restatement of this code.
    expect(isValidPublicKeyMaterial({ ...publicKeyJwk })).toEqual({ ok: true });

    const storedPem = fakeCipher.decrypt(
      prisma.ownKey.create.mock.calls[0][0].data.privateKeyPem as string,
    );
    expect(publicKeyJwk).toEqual(
      createPublicKey(storedPem).export({ format: 'jwk' }),
    );
  });

  it('gives every relation its own key, so one leak does not spread', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.create.mockResolvedValue(ownKeyRow());
    const service = createRelationKeyService({
      db: prisma,
      cipher: fakeCipher,
      now: () => NOW,
    });

    const first = await service.issue('relation-1');
    const second = await service.issue('relation-2');

    expect(first.publicKeyJwk).not.toEqual(second.publicKeyJwk);
    expect(first.keyId).not.toBe(second.keyId);
    const [callA, callB] = prisma.ownKey.create.mock.calls;
    expect(callA[0].data.privateKeyPem).not.toBe(callB[0].data.privateKeyPem);
  });

  it('mints a keyId the peer will accept at registration', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.create.mockResolvedValue(ownKeyRow());
    const service = createRelationKeyService({
      db: prisma,
      cipher: fakeCipher,
      now: () => NOW,
    });

    const { keyId } = await service.issue('relation-1');

    expect(isValidKeyIdShape(keyId)).toBe(true);
  });
});

describe('relationKeyService.signerFor (Requirement 9.6)', () => {
  const withStoredKey = async (prisma: DeepMockProxy<PrismaClient>) => {
    prisma.ownKey.create.mockResolvedValue(ownKeyRow());
    await serviceOver(prisma).issue('relation-1');
    const storedCiphertext = prisma.ownKey.create.mock.calls[0][0].data
      .privateKeyPem as string;
    prisma.ownKey.findUnique.mockResolvedValue(
      ownKeyRow({ privateKeyPem: storedCiphertext }),
    );
    return storedCiphertext;
  };

  it('hands back the means to sign, not the key material', async () => {
    const prisma = mockDeep<PrismaClient>();
    const storedCiphertext = await withStoredKey(prisma);
    prisma.ownKey.findMany.mockResolvedValue([rowForListing()]);

    const signer = await serviceOver(prisma).signerFor('relation-1');

    expect(signer.privateKey.type).toBe('private');
    expect(signer.privateKey.asymmetricKeyType).toBe('ed25519');
    expect(signer.key).toEqual({
      relationId: 'relation-1',
      keyId: 'proxy-key-1',
    });
    expect(Object.keys(signer).sort()).toEqual(['key', 'privateKey']);
    expect(JSON.stringify(signer)).not.toContain(
      fakeCipher.decrypt(storedCiphertext),
    );
  });

  it('produces exactly what sign() takes', async () => {
    const prisma = mockDeep<PrismaClient>();
    await withStoredKey(prisma);
    prisma.ownKey.findMany.mockResolvedValue([rowForListing()]);

    // Compile-time: `lint:typecheck` fails if the shape drifts from SignParams.
    const forSign: Pick<SignParams, 'key' | 'privateKey'> =
      await serviceOver(prisma).signerFor('relation-1');

    expect(forSign.privateKey).toBeInstanceOf(Object);
  });

  it('addresses the key by relation and keyId together', async () => {
    const prisma = mockDeep<PrismaClient>();
    await withStoredKey(prisma);
    prisma.ownKey.findMany.mockResolvedValue([rowForListing()]);

    await serviceOver(prisma).signerFor('relation-1');

    expect(prisma.ownKey.findUnique.mock.calls[0][0].where).toEqual({
      relationId_keyId: { relationId: 'relation-1', keyId: 'proxy-key-1' },
    });
  });

  it('skips a revoked key and signs with the valid one', async () => {
    const prisma = mockDeep<PrismaClient>();
    await withStoredKey(prisma);
    prisma.ownKey.findMany.mockResolvedValue([
      rowForListing({ keyId: 'retired-key', revokedAt: NOW }),
      rowForListing({ keyId: 'proxy-key-1' }),
    ]);

    const signer = await serviceOver(prisma).signerFor('relation-1');

    expect(signer.key.keyId).toBe('proxy-key-1');
  });

  it('refuses to sign for a relation that has no valid key', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.findMany.mockResolvedValue([
      rowForListing({ revokedAt: NOW }),
    ]);

    await expect(serviceOver(prisma).signerFor('relation-1')).rejects.toThrow(
      /no valid signing key/i,
    );
    expect(prisma.ownKey.findUnique).not.toHaveBeenCalled();
  });

  it('keeps signing with the OLD key while a rotation is in flight', async () => {
    // Rotation deliberately leaves both keys valid at once, and design.md is
    // explicit that the old one signs until every GROWI has accepted the new
    // one (「署名は古い鍵で行う — 新しい鍵はまだ相手が知らない」).
    // The rule that produces it reads no clock: a key that supersedes a key
    // which is ITSELF still valid has not taken over yet.
    const prisma = mockDeep<PrismaClient>();
    await withStoredKey(prisma);
    prisma.ownKey.findMany.mockResolvedValue([
      rowForListing({ keyId: 'proxy-key-1' }),
      rowForListing({ keyId: 'proxy-key-2', supersededKeyId: 'proxy-key-1' }),
    ]);

    const signer = await serviceOver(prisma).signerFor('relation-1');

    expect(signer.key.keyId).toBe('proxy-key-1');
  });

  it('hands over to the new key once the old one has been revoked', async () => {
    const prisma = mockDeep<PrismaClient>();
    await withStoredKey(prisma);
    prisma.ownKey.findMany.mockResolvedValue([
      rowForListing({ keyId: 'proxy-key-1', revokedAt: NOW }),
      rowForListing({ keyId: 'proxy-key-2', supersededKeyId: 'proxy-key-1' }),
    ]);

    const signer = await serviceOver(prisma).signerFor('relation-1');

    expect(signer.key.keyId).toBe('proxy-key-2');
  });

  it('refuses to guess when two valid keys have nothing to do with each other', async () => {
    // Not a rotation: neither key replaces the other, so nothing says which
    // one the peer holds. Picking either would sign with a key the peer may
    // never have accepted.
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.findMany.mockResolvedValue([
      rowForListing({ keyId: 'proxy-key-1' }),
      rowForListing({ keyId: 'proxy-key-2' }),
    ]);

    await expect(serviceOver(prisma).signerFor('relation-1')).rejects.toThrow(
      /more than one valid signing key/i,
    );
    expect(prisma.ownKey.findUnique).not.toHaveBeenCalled();
  });

  it('refuses when every valid key is superseded by another valid one', async () => {
    // A state no code here writes, so it means the rows were altered: with
    // every candidate replaced by another, there is no key the peer can be
    // assumed to hold. Reported separately from "no valid key at all", which
    // is an ordinary consequence of revoking.
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.findMany.mockResolvedValue([
      rowForListing({ keyId: 'proxy-key-1', supersededKeyId: 'proxy-key-2' }),
      rowForListing({ keyId: 'proxy-key-2', supersededKeyId: 'proxy-key-1' }),
    ]);

    await expect(serviceOver(prisma).signerFor('relation-1')).rejects.toThrow(
      /none of them is the one that signs/i,
    );
    expect(prisma.ownKey.findUnique).not.toHaveBeenCalled();
  });

  it('reports the row disappearing between the listing and the load', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.findMany.mockResolvedValue([rowForListing()]);
    prisma.ownKey.findUnique.mockResolvedValue(null);

    await expect(serviceOver(prisma).signerFor('relation-1')).rejects.toThrow(
      /vanished/i,
    );
  });
});

describe('relationKeyService.publicKeyFor (Requirement 9.5)', () => {
  it('derives the public half of the relation key it would sign with', async () => {
    // `own_key` stores the private key alone, so the public half is derived --
    // and it has to be the public half of the very key `signerFor` hands out,
    // or the peer would be registering a key nothing signs with.
    const { privateKey } = generateKeyPairSync('ed25519');
    const stored = ownKeyRow({
      privateKeyPem: fakeCipher.encrypt(
        privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      ),
    });
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.findMany.mockResolvedValue([rowForListing(stored)]);
    prisma.ownKey.findUnique.mockResolvedValue(stored);

    const registration = await serviceOver(prisma).publicKeyFor('relation-1');

    expect(registration.keyId).toBe('proxy-key-1');
    expect(registration.validFrom).toBe(stored.validFrom.toISOString());
    expect(registration.publicKeyJwk).toEqual(
      createPublicKey(privateKey).export({ format: 'jwk' }),
    );
    expect(registration.publicKeyJwk).not.toHaveProperty('d');
  });

  it('refuses for the same reasons signing does, rather than inventing a key', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.ownKey.findMany.mockResolvedValue([]);

    await expect(
      serviceOver(prisma).publicKeyFor('relation-1'),
    ).rejects.toThrow(/No valid signing key/i);
  });

  it('answers with the OLD key while a rotation is in flight', async () => {
    // The counterpart of signerFor's "keeps signing with the OLD key": what
    // this hands out is what a GROWI registers and then verifies signatures
    // against, so it has to be the public half of the key that actually
    // signs. Answering with the new key mid-rotation would give the peer
    // material nothing is signed with yet, and every request would fail
    // verification until the rotation finished.
    const old = generateKeyPairSync('ed25519');
    const successor = generateKeyPairSync('ed25519');
    const storedPemOf = (privateKey: KeyObject) =>
      fakeCipher.encrypt(
        privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
      );
    const oldRow = ownKeyRow({
      keyId: 'proxy-key-1',
      privateKeyPem: storedPemOf(old.privateKey),
    });
    const successorRow = ownKeyRow({
      keyId: 'proxy-key-2',
      supersededKeyId: 'proxy-key-1',
      validFrom: NOW,
      privateKeyPem: storedPemOf(successor.privateKey),
    });

    const prisma = mockDeep<PrismaClient>();
    withOwnKeyStore(prisma, [oldRow, successorRow]);

    const registration = await serviceOver(prisma).publicKeyFor('relation-1');

    expect(registration.keyId).toBe('proxy-key-1');
    expect(registration.validFrom).toBe(oldRow.validFrom.toISOString());
    expect(registration.publicKeyJwk).toEqual(
      createPublicKey(old.privateKey).export({ format: 'jwk' }),
    );
    expect(registration.publicKeyJwk).not.toEqual(
      createPublicKey(successor.privateKey).export({ format: 'jwk' }),
    );
  });
});

// ---------------------------------------------------------------------------
// Rotation (task 6.2, Requirements 10.5 / 10.6)
//
// The rotation is a state machine spread over repeated operator commands, so
// these tests run against an in-memory `own_key` table rather than per-call
// canned answers: the second `rotate()` has to SEE what the first one wrote,
// which is the whole property under test (「2 回目以降は作り直さず、届いて
// いない相手にだけ配り直す」). Canned answers would make the assertions pass
// whatever the skip / re-send logic did.
//
// 「署名は古い鍵で行う」 is checked here through `signerFor` run against the
// rows `rotate()` itself wrote, not against a hand-fed listing: `rotate()`
// never signs -- the injected sender does, and it reaches the signing key
// through `signerFor` -- so the only honest check is that the state rotation
// leaves behind still names the OLD key as the one that signs.
// ---------------------------------------------------------------------------

type StoredRow = ReturnType<typeof ownKeyRow>;

/**
 * A minimal `own_key` table behind the mocked delegates: rows survive across
 * calls, so a rotation's later steps read what its earlier steps wrote.
 *
 * `onUpdate` is how a test observes WHEN a write happened relative to a network
 * call, without replacing the store (replacing it would make the rotation's own
 * bookkeeping vanish and the test pass for the wrong reason).
 */
const withOwnKeyStore = (
  prisma: DeepMockProxy<PrismaClient>,
  initial: ReadonlyArray<StoredRow>,
  onUpdate?: (data: Record<string, unknown>) => void,
): { readonly rows: () => ReadonlyArray<StoredRow> } => {
  let rows: ReadonlyArray<StoredRow> = [...initial];

  // Every `as never` below has one reason: the mocked delegates' parameter and
  // return types are Prisma's generated generic query shapes, which no file
  // outside `db/` may name (`architecture.spec.ts` guard 3 forbids reaching
  // into `src/generated/**`). The implementations are therefore written
  // against the narrow shape the repository actually sends, and the assertion
  // is what re-attaches them to the delegate's own type.
  // `growi-selection.spec.ts` documents the same constraint for the same
  // reason; `as never` is used here rather than its `as any` so that no
  // `biome-ignore` is needed.
  prisma.ownKey.findMany.mockImplementation(((args: {
    where: { relationId: string };
  }) =>
    Promise.resolve(
      rows.filter((row) => row.relationId === args.where.relationId),
    )) as never);

  prisma.ownKey.findUnique.mockImplementation(((args: {
    where: { relationId_keyId: { relationId: string; keyId: string } };
  }) => {
    const { relationId, keyId } = args.where.relationId_keyId;
    return Promise.resolve(
      rows.find(
        (row) => row.relationId === relationId && row.keyId === keyId,
      ) ?? null,
    );
  }) as never);

  prisma.ownKey.create.mockImplementation(((args: {
    data: Record<string, unknown>;
  }) => {
    const row = ownKeyRow(args.data);
    rows = [...rows, row];
    return Promise.resolve(row);
  }) as never);

  prisma.ownKey.update.mockImplementation(((args: {
    where: { relationId_keyId: { relationId: string; keyId: string } };
    data: Record<string, unknown>;
  }) => {
    onUpdate?.(args.data);
    const { relationId, keyId } = args.where.relationId_keyId;
    rows = rows.map((row) =>
      row.relationId === relationId && row.keyId === keyId
        ? { ...row, ...args.data }
        : row,
    );
    return Promise.resolve(
      rows.find((row) => row.relationId === relationId && row.keyId === keyId),
    );
  }) as never);

  return { rows: () => rows };
};

const INSTALLATION = 'installation-1';

const relationRow = (id: string, growiUri: string) => ({
  id,
  installationId: INSTALLATION,
  growiUri,
  growiLabel: id,
  searchWeight: 1,
  settingsVersion: 1,
  createdAt: new Date('2026-01-01T00:00:00.000Z'),
});

const ALPHA = relationRow('relation-1', 'https://alpha.example.com/');
const BRAVO = relationRow('relation-2', 'https://bravo.example.com/');

/** A relation that is already paired: one valid, delivered key. */
const pairedKey = (relationId: string, keyId: string) =>
  ownKeyRow({
    id: `row-${relationId}-${keyId}`,
    relationId,
    keyId,
    privateKeyPem: fakeCipher.encrypt(
      generateKeyPairSync('ed25519')
        .privateKey.export({ type: 'pkcs8', format: 'pem' })
        .toString(),
    ),
    deliveredToPeerAt: new Date('2026-01-01T00:00:00.000Z'),
  });

const DELIVERED: KeyDeliveryOutcome = { ok: true, response: { status: 'ok' } };
const UNREACHABLE: KeyDeliveryOutcome = { ok: false, reason: 'unreachable' };

/** A service whose minted keyIds are distinguishable across calls. */
const rotatingServiceOver = (prisma: PrismaClient) => {
  let minted = 0;
  return createRelationKeyService({
    db: prisma,
    cipher: fakeCipher,
    generateKeyId: () => {
      minted += 1;
      return `minted-key-${minted}`;
    },
    now: () => NOW,
  });
};

describe('relationKeyService.rotate (Requirement 10.5)', () => {
  it('mints one new key per relation, leaves the old one valid, and offers the new public key to each GROWI', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA, BRAVO]);
    const store = withOwnKeyStore(prisma, [
      pairedKey('relation-1', 'old-1'),
      pairedKey('relation-2', 'old-2'),
    ]);
    const send = vi.fn<SendKeyRegistration>().mockResolvedValue(DELIVERED);

    const results = await rotatingServiceOver(prisma).rotate(
      INSTALLATION,
      send,
    );

    expect(results).toEqual([
      {
        relationId: 'relation-1',
        newKeyId: 'minted-key-1',
        delivery: { ok: true },
      },
      {
        relationId: 'relation-2',
        newKeyId: 'minted-key-2',
        delivery: { ok: true },
      },
    ]);

    // Sent to each relation's OWN GROWI, carrying that relation's own new key.
    expect(send.mock.calls.map(([uri]) => uri)).toEqual([
      ALPHA.growiUri,
      BRAVO.growiUri,
    ]);
    const [, first] = send.mock.calls[0];
    expect(first.relationId).toBe('relation-1');
    expect(first.op).toBe('key-register-to-growi');
    expect(first.key.keyId).toBe('minted-key-1');
    expect(first.key.validFrom).toBe(NOW.toISOString());
    // The peer's own registration gate, not a restatement of this code.
    expect(isValidPublicKeyMaterial({ ...first.key.publicKeyJwk })).toEqual({
      ok: true,
    });
    expect(JSON.stringify(first)).not.toContain('PRIVATE KEY');

    // The old key stays valid: nothing may stop signing before step 4.
    const rows = store.rows();
    expect(rows.filter((row) => row.revokedAt != null)).toEqual([]);
    expect(
      rows
        .filter((row) => row.supersededKeyId != null)
        .map((row) => [row.keyId, row.supersededKeyId, row.deliveredToPeerAt]),
    ).toEqual([
      ['minted-key-1', 'old-1', NOW],
      ['minted-key-2', 'old-2', NOW],
    ]);
  });

  it('leaves the OLD key as the one that signs, judged on the rows rotation itself wrote', async () => {
    // 「署名は古い鍵で行う — 新しい鍵はまだ相手が知らない」. The sender reaches
    // the signing key through `signerFor`, so this has to hold for the state
    // `rotate()` leaves behind -- including DURING the send, which is why the
    // new row must be written before the sender is called.
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    withOwnKeyStore(prisma, [pairedKey('relation-1', 'old-1')]);
    const service = rotatingServiceOver(prisma);
    const signingKeyDuringSend: string[] = [];
    const send = vi.fn<SendKeyRegistration>().mockImplementation(async () => {
      signingKeyDuringSend.push(
        (await service.signerFor('relation-1')).key.keyId,
      );
      return DELIVERED;
    });

    await service.rotate(INSTALLATION, send);

    expect(signingKeyDuringSend).toEqual(['old-1']);
    expect((await service.signerFor('relation-1')).key.keyId).toBe('old-1');
  });

  it('records a relation as undelivered when the GROWI could not be reached', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    const store = withOwnKeyStore(prisma, [pairedKey('relation-1', 'old-1')]);
    const send = vi.fn<SendKeyRegistration>().mockResolvedValue(UNREACHABLE);

    const results = await rotatingServiceOver(prisma).rotate(
      INSTALLATION,
      send,
    );

    expect(results[0].delivery).toEqual({ ok: false, reason: 'unreachable' });
    expect(
      store.rows().find((row) => row.keyId === 'minted-key-1')
        ?.deliveredToPeerAt,
    ).toBeNull();
  });

  it('does not count a rejected registration as delivered', async () => {
    // A rejection is a 2xx answer, so it is not a transport failure -- but the
    // peer did not take the key, and marking it delivered would let step 4
    // revoke the old key while the GROWI still holds only that one.
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    const store = withOwnKeyStore(prisma, [pairedKey('relation-1', 'old-1')]);
    const send = vi.fn<SendKeyRegistration>().mockResolvedValue({
      ok: true,
      response: { status: 'rejected', reason: 'invalid-key' },
    });

    const results = await rotatingServiceOver(prisma).rotate(
      INSTALLATION,
      send,
    );

    expect(results[0].delivery).toEqual({
      ok: false,
      reason: 'rejected:invalid-key',
    });
    expect(
      store.rows().find((row) => row.keyId === 'minted-key-1')
        ?.deliveredToPeerAt,
    ).toBeNull();
  });

  it('never lets one relation’s failure stop the others', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA, BRAVO]);
    withOwnKeyStore(prisma, [
      pairedKey('relation-1', 'old-1'),
      pairedKey('relation-2', 'old-2'),
    ]);
    const send = vi
      .fn<SendKeyRegistration>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(DELIVERED);

    const results = await rotatingServiceOver(prisma).rotate(
      INSTALLATION,
      send,
    );

    expect(results[0].delivery.ok).toBe(false);
    expect(results[1].delivery).toEqual({ ok: true });
  });

  it('re-sends the SAME key on a second run instead of minting another one', async () => {
    // 「2 回目以降は作り直さず、届いていない相手にだけ配り直す」: minting again
    // would pile up keys the old one never gets revoked behind.
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    const store = withOwnKeyStore(prisma, [pairedKey('relation-1', 'old-1')]);
    const send = vi
      .fn<SendKeyRegistration>()
      .mockResolvedValueOnce(UNREACHABLE)
      .mockResolvedValue(DELIVERED);
    const service = rotatingServiceOver(prisma);

    await service.rotate(INSTALLATION, send);
    const results = await service.rotate(INSTALLATION, send);

    expect(results[0].newKeyId).toBe('minted-key-1');
    // The SAME public key is offered again, not a second one minted for the
    // retry: the peer must end up holding the key this proxy will sign with.
    expect(send.mock.calls[1][1].key).toEqual(send.mock.calls[0][1].key);
    expect(store.rows().map((row) => row.keyId)).toEqual([
      'old-1',
      'minted-key-1',
    ]);
    expect(
      store.rows().find((row) => row.keyId === 'minted-key-1')
        ?.deliveredToPeerAt,
    ).toEqual(NOW);
  });

  it('leaves a relation alone once its new key has reached the GROWI', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    withOwnKeyStore(prisma, [pairedKey('relation-1', 'old-1')]);
    const send = vi.fn<SendKeyRegistration>().mockResolvedValue(DELIVERED);
    const service = rotatingServiceOver(prisma);

    await service.rotate(INSTALLATION, send);
    const results = await service.rotate(INSTALLATION, send);

    expect(send).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      {
        relationId: 'relation-1',
        newKeyId: 'minted-key-1',
        delivery: { ok: true },
      },
    ]);
  });

  it('reports a relation with no valid key instead of minting one nothing can vouch for', async () => {
    // A key revoked without the relation being unpaired. A fresh key here
    // would have to be signed by itself, which no GROWI holds -- so the
    // relation is reported as it is, and no key is written.
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    const store = withOwnKeyStore(prisma, [
      ownKeyRow({ relationId: 'relation-1', keyId: 'old-1', revokedAt: NOW }),
    ]);
    const send = vi.fn<SendKeyRegistration>().mockResolvedValue(DELIVERED);

    const results = await rotatingServiceOver(prisma).rotate(
      INSTALLATION,
      send,
    );

    expect(results[0].newKeyId).toBeNull();
    expect(results[0].delivery.ok).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(store.rows()).toHaveLength(1);
  });
});

describe('relationKeyService.revokeOldIfAllDelivered (Requirement 10.6)', () => {
  it('holds the old keys until every GROWI has the new one, and revokes only after the last one is fixed', async () => {
    // The acceptance criterion of task 6.2, end to end: one GROWI is down, so
    // nothing is revoked anywhere; the operator fixes it and runs `rotate`
    // again, which re-sends to that one alone; only then does step 4 proceed.
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA, BRAVO]);
    const store = withOwnKeyStore(prisma, [
      pairedKey('relation-1', 'old-1'),
      pairedKey('relation-2', 'old-2'),
    ]);
    const sendRegistration = vi
      .fn<SendKeyRegistration>()
      .mockImplementation(async (_uri, request) =>
        request.relationId === 'relation-2' ? UNREACHABLE : DELIVERED,
      );
    const sendRevocation = vi
      .fn<SendKeyRevocation>()
      .mockResolvedValue(DELIVERED);
    const service = rotatingServiceOver(prisma);

    await service.rotate(INSTALLATION, sendRegistration);

    // One relation is behind, so NOTHING is revoked -- not even the relation
    // that did receive its new key.
    expect(
      await service.revokeOldIfAllDelivered(INSTALLATION, sendRevocation),
    ).toBe(false);
    expect(sendRevocation).not.toHaveBeenCalled();
    expect(store.rows().filter((row) => row.revokedAt != null)).toEqual([]);

    // The operator fixes the GROWI and runs `rotate-key` again.
    sendRegistration.mockResolvedValue(DELIVERED);
    const second = await service.rotate(INSTALLATION, sendRegistration);

    expect(second.map((result) => result.newKeyId)).toEqual([
      'minted-key-1',
      'minted-key-2',
    ]);
    // Only the relation that was behind is contacted again.
    expect(
      sendRegistration.mock.calls
        .slice(2)
        .map(([, request]) => request.relationId),
    ).toEqual(['relation-2']);

    expect(
      await service.revokeOldIfAllDelivered(INSTALLATION, sendRevocation),
    ).toBe(true);
    expect(
      sendRevocation.mock.calls.map(([uri, request]) => [
        uri,
        request.relationId,
        request.keyId,
        request.op,
      ]),
    ).toEqual([
      [ALPHA.growiUri, 'relation-1', 'old-1', 'key-revoke-to-growi'],
      [BRAVO.growiUri, 'relation-2', 'old-2', 'key-revoke-to-growi'],
    ]);
    expect(
      store.rows().map((row) => [row.keyId, row.revokedAt != null]),
    ).toEqual([
      ['old-1', true],
      ['old-2', true],
      ['minted-key-1', false],
      ['minted-key-2', false],
    ]);

    // And the new key takes over signing only now that the old one is gone.
    expect((await service.signerFor('relation-1')).key.keyId).toBe(
      'minted-key-1',
    );
  });

  it('tells the GROWI before it stops using the key itself', async () => {
    // Reversing this would leave the GROWI holding a public key this proxy has
    // already dropped, which is the one thing the rotation exists to end.
    const events: string[] = [];
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    withOwnKeyStore(prisma, [pairedKey('relation-1', 'old-1')], (data) => {
      if (data.revokedAt != null) events.push('revoked-locally');
    });
    const service = rotatingServiceOver(prisma);

    await service.rotate(
      INSTALLATION,
      vi.fn<SendKeyRegistration>().mockResolvedValue(DELIVERED),
    );
    await service.revokeOldIfAllDelivered(
      INSTALLATION,
      vi.fn<SendKeyRevocation>().mockImplementation(() => {
        events.push('told-the-peer');
        return Promise.resolve(DELIVERED);
      }),
    );

    expect(events).toEqual(['told-the-peer', 'revoked-locally']);
  });

  it('goes ahead when the GROWI answers that it does not know the key', async () => {
    // Nothing left to tell that peer: the key it is being asked to drop is
    // already gone from its side.
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    const store = withOwnKeyStore(prisma, [pairedKey('relation-1', 'old-1')]);
    const service = rotatingServiceOver(prisma);
    await service.rotate(
      INSTALLATION,
      vi.fn<SendKeyRegistration>().mockResolvedValue(DELIVERED),
    );

    const revoked = await service.revokeOldIfAllDelivered(
      INSTALLATION,
      vi.fn<SendKeyRevocation>().mockResolvedValue({
        ok: true,
        response: { status: 'rejected', reason: 'unknown-key' },
      }),
    );

    expect(revoked).toBe(true);
    expect(
      store.rows().find((row) => row.keyId === 'old-1')?.revokedAt,
    ).toEqual(NOW);
  });

  it('keeps the old key when the GROWI says dropping it would leave it with none', async () => {
    // That answer means the new key never actually landed there, whatever
    // this proxy recorded. Revoking now would sign every later request with a
    // key that GROWI does not hold.
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    const store = withOwnKeyStore(prisma, [pairedKey('relation-1', 'old-1')]);
    const service = rotatingServiceOver(prisma);
    await service.rotate(
      INSTALLATION,
      vi.fn<SendKeyRegistration>().mockResolvedValue(DELIVERED),
    );

    const revoked = await service.revokeOldIfAllDelivered(
      INSTALLATION,
      vi.fn<SendKeyRevocation>().mockResolvedValue({
        ok: true,
        response: { status: 'rejected', reason: 'would-leave-no-valid-key' },
      }),
    );

    expect(revoked).toBe(false);
    expect(store.rows().find((row) => row.keyId === 'old-1')?.revokedAt).toBe(
      null,
    );
  });

  it('keeps the old key when the GROWI could not be told at all', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    const store = withOwnKeyStore(prisma, [pairedKey('relation-1', 'old-1')]);
    const service = rotatingServiceOver(prisma);
    await service.rotate(
      INSTALLATION,
      vi.fn<SendKeyRegistration>().mockResolvedValue(DELIVERED),
    );

    const revoked = await service.revokeOldIfAllDelivered(
      INSTALLATION,
      vi.fn<SendKeyRevocation>().mockResolvedValue(UNREACHABLE),
    );

    expect(revoked).toBe(false);
    expect(store.rows().find((row) => row.keyId === 'old-1')?.revokedAt).toBe(
      null,
    );
  });

  it('picks up where a half-finished revocation left off, without touching what is already done', async () => {
    // The first attempt tells one GROWI and fails at the other, so one old key
    // is revoked and one is not. Running it again must retry only the one left
    // over: a relation whose old key is already revoked has no rotation under
    // way any more.
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA, BRAVO]);
    const store = withOwnKeyStore(prisma, [
      pairedKey('relation-1', 'old-1'),
      pairedKey('relation-2', 'old-2'),
    ]);
    const service = rotatingServiceOver(prisma);
    await service.rotate(
      INSTALLATION,
      vi.fn<SendKeyRegistration>().mockResolvedValue(DELIVERED),
    );

    const sendRevocation = vi
      .fn<SendKeyRevocation>()
      .mockImplementation(async (_uri, request) =>
        request.relationId === 'relation-2' ? UNREACHABLE : DELIVERED,
      );
    expect(
      await service.revokeOldIfAllDelivered(INSTALLATION, sendRevocation),
    ).toBe(false);
    expect(
      store.rows().map((row) => [row.keyId, row.revokedAt != null]),
    ).toEqual([
      ['old-1', true],
      ['old-2', false],
      ['minted-key-1', false],
      ['minted-key-2', false],
    ]);

    sendRevocation.mockResolvedValue(DELIVERED);
    expect(
      await service.revokeOldIfAllDelivered(INSTALLATION, sendRevocation),
    ).toBe(true);

    expect(
      sendRevocation.mock.calls.slice(2).map(([, request]) => request.keyId),
    ).toEqual(['old-2']);
    expect(
      store.rows().map((row) => [row.keyId, row.revokedAt != null]),
    ).toEqual([
      ['old-1', true],
      ['old-2', true],
      ['minted-key-1', false],
      ['minted-key-2', false],
    ]);
  });

  it('does nothing when no rotation is under way', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    withOwnKeyStore(prisma, [pairedKey('relation-1', 'old-1')]);
    const send = vi.fn<SendKeyRevocation>().mockResolvedValue(DELIVERED);

    const revoked = await rotatingServiceOver(prisma).revokeOldIfAllDelivered(
      INSTALLATION,
      send,
    );

    expect(revoked).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('stops rather than revoke around a relation whose keys cannot be read', async () => {
    // Two valid keys that do not replace each other is a state nothing here
    // writes, so it means the rows were altered. Whether that relation has a
    // rotation under way is unknowable, and 「全員に届いた」 cannot be claimed
    // without it -- so the whole workspace waits.
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA, BRAVO]);
    const store = withOwnKeyStore(prisma, [
      pairedKey('relation-1', 'old-1'),
      ownKeyRow({ relationId: 'relation-2', keyId: 'stray-a' }),
      ownKeyRow({ relationId: 'relation-2', keyId: 'stray-b' }),
    ]);
    const service = rotatingServiceOver(prisma);
    await service.rotate(
      INSTALLATION,
      vi.fn<SendKeyRegistration>().mockResolvedValue(DELIVERED),
    );
    const sendRevocation = vi
      .fn<SendKeyRevocation>()
      .mockResolvedValue(DELIVERED);

    expect(
      await service.revokeOldIfAllDelivered(INSTALLATION, sendRevocation),
    ).toBe(false);
    expect(sendRevocation).not.toHaveBeenCalled();
    expect(store.rows().filter((row) => row.revokedAt != null)).toEqual([]);
  });
});

describe('relationKeyService.rotationStatus (Requirement 10.5)', () => {
  // What `rotate-key status` shows an operator BEFORE step 4 runs
  // (design.md: 「入れ替えの途中経過（関係ごとの未達）を見る」).
  // `revokeOldIfAllDelivered` answers one boolean for the whole installation,
  // which cannot say WHICH GROWI is holding the rotation up -- and the rule
  // for "which key is in charge" lives in this module, so re-deriving it from
  // `listKeys` at the call site would put the same policy in two places.
  it('names, per relation, the key being moved to and whether the GROWI has it', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA, BRAVO]);
    withOwnKeyStore(prisma, [
      pairedKey('relation-1', 'old-1'),
      ownKeyRow({
        id: 'row-new-1',
        relationId: 'relation-1',
        keyId: 'new-1',
        supersededKeyId: 'old-1',
        deliveredToPeerAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
      pairedKey('relation-2', 'old-2'),
      ownKeyRow({
        id: 'row-new-2',
        relationId: 'relation-2',
        keyId: 'new-2',
        supersededKeyId: 'old-2',
        deliveredToPeerAt: null,
      }),
    ]);

    await expect(
      serviceOver(prisma).rotationStatus(INSTALLATION),
    ).resolves.toEqual([
      {
        relationId: 'relation-1',
        growiLabel: 'relation-1',
        newKeyId: 'new-1',
        deliveredToPeer: true,
        problem: null,
      },
      {
        relationId: 'relation-2',
        growiLabel: 'relation-2',
        newKeyId: 'new-2',
        deliveredToPeer: false,
        problem: null,
      },
    ]);
  });

  it('says a relation has no rotation under way rather than leaving it out', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    withOwnKeyStore(prisma, [pairedKey('relation-1', 'old-1')]);

    await expect(
      serviceOver(prisma).rotationStatus(INSTALLATION),
    ).resolves.toEqual([
      {
        relationId: 'relation-1',
        growiLabel: 'relation-1',
        newKeyId: null,
        deliveredToPeer: false,
        problem: null,
      },
    ]);
  });

  it('reports a relation whose keys do not say which one signs, instead of guessing', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    withOwnKeyStore(prisma, []);

    await expect(
      serviceOver(prisma).rotationStatus(INSTALLATION),
    ).resolves.toEqual([
      {
        relationId: 'relation-1',
        growiLabel: 'relation-1',
        newKeyId: null,
        deliveredToPeer: false,
        problem: 'no-valid-key',
      },
    ]);
  });

  it('changes nothing: no key is minted, marked or revoked by looking', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.relation.findMany.mockResolvedValue([ALPHA]);
    withOwnKeyStore(prisma, [pairedKey('relation-1', 'old-1')]);

    await serviceOver(prisma).rotationStatus(INSTALLATION);

    expect(prisma.ownKey.create).not.toHaveBeenCalled();
    expect(prisma.ownKey.update).not.toHaveBeenCalled();
  });
});
