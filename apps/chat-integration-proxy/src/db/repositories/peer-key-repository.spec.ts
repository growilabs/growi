// The GROWI side's public keys. Nothing here is encrypted (a public key is
// public), so these tests are about the two properties that keep one relation
// from being answered with another's key material, and about honouring a key's
// validity window during a rotation (Requirement 10.5, 10.6).
import { generateKeyPairSync } from 'node:crypto';
import { mockDeep } from 'vitest-mock-extended';

import type { PrismaClient } from '../prisma-client.js';
import { createPeerKeyRepository } from './peer-key-repository.js';

const { publicKey } = generateKeyPairSync('ed25519');
// Named as a plain record rather than `JsonWebKey`: what a `peer_key` row holds
// is a JSON column, and `node:crypto`'s `JsonWebKey` is a separate declaration
// that does not fit Prisma's `JsonValue`.
const PUBLIC_JWK: Record<string, string> = publicKey.export({
  format: 'jwk',
}) as Record<string, string>;

const NOW = new Date('2026-06-01T00:00:00.000Z');

const row = (overrides: Partial<Record<string, unknown>> = {}) => ({
  id: 'peer-key-row-1',
  relationId: 'relation-1',
  keyId: 'growi-key-1',
  publicKeyJwk: PUBLIC_JWK,
  validFrom: new Date('2026-01-01T00:00:00.000Z'),
  revokedAt: null,
  ...overrides,
});

describe('peerKeyRepository.findPublicKey (Requirement 10.5, 10.6)', () => {
  it('never resolves a key by keyId alone', async () => {
    // Two GROWI instances may each have chosen the same keyId; looking one up
    // without its relation would verify a signature against the wrong party's
    // key.
    const prisma = mockDeep<PrismaClient>();
    prisma.peerKey.findUnique.mockResolvedValue(row());
    const repository = createPeerKeyRepository(prisma);

    await repository.findPublicKey(
      { relationId: 'relation-1', keyId: 'growi-key-1' },
      NOW,
    );

    expect(prisma.peerKey.findUnique.mock.calls[0][0].where).toEqual({
      relationId_keyId: { relationId: 'relation-1', keyId: 'growi-key-1' },
    });
  });

  it('returns a usable public key for a currently valid registration', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.peerKey.findUnique.mockResolvedValue(row());
    const repository = createPeerKeyRepository(prisma);

    const key = await repository.findPublicKey(
      { relationId: 'relation-1', keyId: 'growi-key-1' },
      NOW,
    );

    expect(key?.type).toBe('public');
    expect(key?.asymmetricKeyType).toBe('ed25519');
  });

  it('refuses a revoked key', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.peerKey.findUnique.mockResolvedValue(
      row({ revokedAt: new Date('2026-05-01T00:00:00.000Z') }),
    );
    const repository = createPeerKeyRepository(prisma);

    await expect(
      repository.findPublicKey(
        { relationId: 'relation-1', keyId: 'growi-key-1' },
        NOW,
      ),
    ).resolves.toBeNull();
  });

  it('refuses a key whose validity has not started yet', async () => {
    // Registered ahead of a rotation: never revoked, but the peer cannot be
    // signing with it yet either.
    const prisma = mockDeep<PrismaClient>();
    prisma.peerKey.findUnique.mockResolvedValue(
      row({ validFrom: new Date('2026-07-01T00:00:00.000Z') }),
    );
    const repository = createPeerKeyRepository(prisma);

    await expect(
      repository.findPublicKey(
        { relationId: 'relation-1', keyId: 'growi-key-1' },
        NOW,
      ),
    ).resolves.toBeNull();
  });

  it('answers null for a key that was never registered', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.peerKey.findUnique.mockResolvedValue(null);
    const repository = createPeerKeyRepository(prisma);

    await expect(
      repository.findPublicKey(
        { relationId: 'relation-1', keyId: 'unknown' },
        NOW,
      ),
    ).resolves.toBeNull();
  });

  it('refuses stored key material that is not an Ed25519 public key', async () => {
    // The registering side validates this, but a row that reached the database
    // some other way must not be turned into a key object regardless.
    const prisma = mockDeep<PrismaClient>();
    prisma.peerKey.findUnique.mockResolvedValue(
      row({ publicKeyJwk: { kty: 'oct', k: 'AAAA' } }),
    );
    const repository = createPeerKeyRepository(prisma);

    await expect(
      repository.findPublicKey(
        { relationId: 'relation-1', keyId: 'growi-key-1' },
        NOW,
      ),
    ).rejects.toThrow();
  });
});

describe('peerKeyRepository.listKeys (Requirement 10.5)', () => {
  it('reports the whole relation’s keys in the shape judgeKeyRevocation reads', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.peerKey.findMany.mockResolvedValue([
      row(),
      row({
        id: 'peer-key-row-2',
        keyId: 'growi-key-2',
        validFrom: new Date('2026-05-01T00:00:00.000Z'),
        revokedAt: new Date('2026-05-20T00:00:00.000Z'),
      }),
    ]);
    const repository = createPeerKeyRepository(prisma);

    await expect(repository.listKeys('relation-1')).resolves.toEqual([
      {
        keyId: 'growi-key-1',
        validFrom: '2026-01-01T00:00:00.000Z',
        revokedAt: null,
      },
      {
        keyId: 'growi-key-2',
        validFrom: '2026-05-01T00:00:00.000Z',
        revokedAt: '2026-05-20T00:00:00.000Z',
      },
    ]);
  });
});

describe('peerKeyRepository.deleteByRelation', () => {
  it('deletes every key of the relation and answers the count removed', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.peerKey.deleteMany.mockResolvedValue({ count: 3 });
    const repository = createPeerKeyRepository(prisma);

    await expect(repository.deleteByRelation('relation-1')).resolves.toBe(3);
    expect(prisma.peerKey.deleteMany).toHaveBeenCalledWith({
      where: { relationId: 'relation-1' },
    });
  });
});
