import type { KeyRef } from '@growi/chat/server';
import { mockDeep } from 'vitest-mock-extended';

import { Prisma } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../prisma-client.js';
import { createRequestNonceRepository } from './request-nonce-repository.js';

const REF: KeyRef = { relationId: 'relation-1', keyId: 'growi-key-1' };

const uniqueConstraintViolation = () =>
  new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '6.19.2',
  });

describe('requestNonceRepository.consumeNonce (Requirement 10.4)', () => {
  it('answers true and inserts the row the first time a nonce is seen', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.requestNonce.create.mockResolvedValue({
      relationId: REF.relationId,
      keyId: REF.keyId,
      nonce: 'nonce-1',
      expiresAt: new Date('2026-01-01T00:05:00.000Z'),
    });
    const repository = createRequestNonceRepository(prisma);
    const expiresAt = new Date('2026-01-01T00:05:00.000Z');

    await expect(
      repository.consumeNonce(REF, 'nonce-1', expiresAt),
    ).resolves.toBe(true);
    expect(prisma.requestNonce.create).toHaveBeenCalledWith({
      data: {
        relationId: REF.relationId,
        keyId: REF.keyId,
        nonce: 'nonce-1',
        expiresAt,
      },
    });
  });

  it('answers false, without throwing, when the same nonce was already recorded (a replay)', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.requestNonce.create.mockRejectedValue(uniqueConstraintViolation());
    const repository = createRequestNonceRepository(prisma);

    await expect(
      repository.consumeNonce(REF, 'nonce-1', new Date()),
    ).resolves.toBe(false);
  });

  it('rethrows any other database error rather than treating it as a replay', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.requestNonce.create.mockRejectedValue(new Error('connection lost'));
    const repository = createRequestNonceRepository(prisma);

    await expect(
      repository.consumeNonce(REF, 'nonce-1', new Date()),
    ).rejects.toThrow('connection lost');
  });

  it("stores the expiry it is given as-is (clamping is the caller's job)", async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.requestNonce.create.mockResolvedValue({
      relationId: REF.relationId,
      keyId: REF.keyId,
      nonce: 'nonce-2',
      expiresAt: new Date('2026-01-01T00:05:00.000Z'),
    });
    const repository = createRequestNonceRepository(prisma);
    const clampedExpiry = new Date('2026-01-01T00:05:00.000Z');

    await repository.consumeNonce(REF, 'nonce-2', clampedExpiry);

    expect(prisma.requestNonce.create.mock.calls[0][0].data.expiresAt).toBe(
      clampedExpiry,
    );
  });
});

describe('requestNonceRepository.deleteExpired', () => {
  it('deletes every row past its expiresAt and answers the count removed', async () => {
    const prisma = mockDeep<PrismaClient>();
    prisma.requestNonce.deleteMany.mockResolvedValue({ count: 7 });
    const repository = createRequestNonceRepository(prisma);
    const now = new Date('2026-02-01T00:00:00.000Z');

    await expect(repository.deleteExpired(now)).resolves.toBe(7);
    expect(prisma.requestNonce.deleteMany).toHaveBeenCalledWith({
      where: { expiresAt: { lte: now } },
    });
  });
});
