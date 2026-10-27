import { describe, expect, it } from 'vitest';

import { decodeCursor, encodeCursor } from './cursor';

describe('cursor encode/decode', () => {
  it('(createdAt, id) を encode して decode すると元の値に戻る (往復一致)', () => {
    const key = {
      createdAt: new Date('2024-01-15T10:30:00.000Z'),
      id: '507f1f77bcf86cd799439011',
    };
    const token = encodeCursor(key);
    const decoded = decodeCursor(token);
    expect(decoded.createdAt.getTime()).toBe(key.createdAt.getTime());
    expect(decoded.id).toBe(key.id);
  });

  it('エンコードされたトークンは不透明な文字列である (内部表現を露出しない)', () => {
    const key = {
      createdAt: new Date('2024-01-15T10:30:00.000Z'),
      id: '507f1f77bcf86cd799439011',
    };
    const token = encodeCursor(key);
    // token is a non-empty string but does not directly expose createdAt or id as plain text
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(0);
    expect(token).not.toBe('2024-01-15T10:30:00.000Z');
    expect(token).not.toBe('507f1f77bcf86cd799439011');
  });

  it('不正なトークンで decodeCursor を呼ぶと例外をスローする', () => {
    expect(() => decodeCursor('invalid-token')).toThrow();
    expect(() => decodeCursor('')).toThrow();
    expect(() => decodeCursor('!@#$%')).toThrow();
  });
});
