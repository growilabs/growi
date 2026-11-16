import { MAX_PURPOSE_LENGTH, MAX_REVIEWERS } from '../../interfaces';
import { normalizeCreateInput } from './normalize-create-input';

const minimal = {
  entry: 'ai-chat',
  operations: [{ type: 'create', path: '/a', body: 'x' }],
};

const userIds = (count: number): readonly string[] =>
  Array.from({ length: count }, (_, i) => `user-${i}`);

describe('normalizeCreateInput: purpose', () => {
  it(`accepts a purpose of ${MAX_PURPOSE_LENGTH} code points (emoji count once) and keeps it as is (Reviewers Req 1.8, 1.9)`, () => {
    const purpose = '😀'.repeat(MAX_PURPOSE_LENGTH);

    const result = normalizeCreateInput({ ...minimal, purpose });

    expect(result).toMatchObject({ ok: true, value: { purpose } });
  });

  it(`rejects a purpose of ${MAX_PURPOSE_LENGTH + 1} code points (Reviewers Req 1.9)`, () => {
    const result = normalizeCreateInput({
      ...minimal,
      purpose: 'あ'.repeat(MAX_PURPOSE_LENGTH + 1),
    });

    expect(result).toEqual({
      ok: false,
      rejection: { code: 'purpose-too-long', max: MAX_PURPOSE_LENGTH },
    });
  });

  it('rejects a purpose that is not a string', () => {
    const result = normalizeCreateInput({ ...minimal, purpose: { $ne: '' } });

    expect(result).toMatchObject({
      ok: false,
      rejection: { code: 'purpose-too-long' },
    });
  });

  it('leaves the purpose out when none is given', () => {
    const result = normalizeCreateInput(minimal);

    expect(result.ok).toBe(true);
    expect(result.ok && result.value).not.toHaveProperty('purpose');
  });
});

describe('normalizeCreateInput: reviewers', () => {
  it('copies users, user groups and external groups, dropping extra fields (Reviewers Req 1.2)', () => {
    const result = normalizeCreateInput({
      ...minimal,
      reviewers: [
        { kind: 'user', id: 'u1', addedBy: 'someone-else' },
        { kind: 'user-group', id: 'g1' },
        { kind: 'external-user-group', id: 'e1' },
      ],
    });

    expect(result).toEqual({
      ok: true,
      value: expect.objectContaining({
        reviewers: [
          { kind: 'user', id: 'u1' },
          { kind: 'user-group', id: 'g1' },
          { kind: 'external-user-group', id: 'e1' },
        ],
      }),
    });
  });

  it('collapses the same user or group given twice into one (Reviewers Req 1.6)', () => {
    const result = normalizeCreateInput({
      ...minimal,
      reviewers: [
        { kind: 'user', id: 'u1' },
        { kind: 'user-group', id: 'u1' },
        { kind: 'user', id: 'u1' },
      ],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        reviewers: [
          { kind: 'user', id: 'u1' },
          { kind: 'user-group', id: 'u1' },
        ],
      },
    });
  });

  it(`accepts ${MAX_REVIEWERS} reviewers, and ${MAX_REVIEWERS + 1} entries when one is a duplicate (Reviewers Req 1.7)`, () => {
    const atLimit = userIds(MAX_REVIEWERS).map((id) => ({ kind: 'user', id }));

    expect(normalizeCreateInput({ ...minimal, reviewers: atLimit }).ok).toBe(
      true,
    );
    expect(
      normalizeCreateInput({
        ...minimal,
        reviewers: [...atLimit, atLimit[0]],
      }),
    ).toMatchObject({ ok: true, value: { reviewers: atLimit } });
  });

  it(`rejects ${MAX_REVIEWERS + 1} different reviewers (Reviewers Req 1.7)`, () => {
    const result = normalizeCreateInput({
      ...minimal,
      reviewers: userIds(MAX_REVIEWERS + 1).map((id) => ({ kind: 'user', id })),
    });

    expect(result).toEqual({
      ok: false,
      rejection: { code: 'too-many-reviewers', max: MAX_REVIEWERS },
    });
  });

  it.each([
    [
      'an unknown kind',
      [
        { kind: 'user', id: 'u1' },
        { kind: 'role', id: 'r' },
      ],
      1,
    ],
    ['a non-string id', [{ kind: 'user', id: { $ne: null } }], 0],
    ['a non-object entry', [{ kind: 'user', id: 'u1' }, 'u2'], 1],
  ])('rejects %s, pointing at it', (_label, reviewers, index) => {
    const result = normalizeCreateInput({ ...minimal, reviewers });

    expect(result).toEqual({
      ok: false,
      rejection: { code: 'invalid-reviewer', index },
    });
  });

  it('rejects reviewers that are not an array', () => {
    const result = normalizeCreateInput({
      ...minimal,
      reviewers: { kind: 'user', id: 'u1' },
    });

    expect(result).toMatchObject({
      ok: false,
      rejection: { code: 'invalid-reviewer' },
    });
  });

  it('tells an explicit empty list apart from no list', () => {
    const empty = normalizeCreateInput({ ...minimal, reviewers: [] });
    const absent = normalizeCreateInput(minimal);

    expect(empty).toMatchObject({ ok: true, value: { reviewers: [] } });
    expect(absent.ok).toBe(true);
    expect(absent.ok && absent.value).not.toHaveProperty('reviewers');
  });
});
