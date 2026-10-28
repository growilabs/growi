import type {
  CreatableOperationInput,
  CreatableOperationType,
} from '../../interfaces';
import { MAX_TOTAL_BODY_BYTES } from '../../interfaces';
import {
  type ProposalInputLimits,
  validateProposalInput,
} from './validate-proposal-input';

const edit = (body = 'x'): CreatableOperationInput => ({
  type: 'edit',
  pageId: 'p1',
  baseRevisionId: 'r1',
  body,
});
const create = (path = '/new/page', body = 'x'): CreatableOperationInput => ({
  type: 'create',
  path,
  body,
});
const move = (toPath = '/moved'): CreatableOperationInput => ({
  type: 'move',
  pageId: 'p1',
  fromPath: '/from',
  toPath,
});

const limits = (overrides: Partial<ProposalInputLimits> = {}) => ({
  maxOperations: 50,
  maxTotalBodyBytes: MAX_TOTAL_BODY_BYTES,
  enabledOperationTypes: new Set<CreatableOperationType>([
    'edit',
    'create',
    'move',
  ]),
  ...overrides,
});

describe('validateProposalInput', () => {
  it('accepts edit, create and one move together', () => {
    expect(validateProposalInput([edit(), create(), move()], limits())).toEqual(
      { ok: true },
    );
  });

  describe('empty-operations', () => {
    it('rejects an empty list', () => {
      expect(validateProposalInput([], limits())).toEqual({
        ok: false,
        rejection: { code: 'empty-operations' },
      });
    });
  });

  describe('unsupported-operation-type (req 1.5)', () => {
    it.each([
      'trash',
      'restore',
      'delete-completely',
      'delete',
      '',
    ])('rejects type %j with the index of the first offender', (type) => {
      const bad = { type, pageId: 'p1' } as unknown as CreatableOperationInput;
      expect(validateProposalInput([edit(), bad, bad], limits())).toEqual({
        ok: false,
        rejection: { code: 'unsupported-operation-type', index: 1 },
      });
    });
  });

  describe('multiple-move-operations (req 1.6)', () => {
    it('rejects two moves', () => {
      expect(validateProposalInput([move('/a'), move('/b')], limits())).toEqual(
        { ok: false, rejection: { code: 'multiple-move-operations' } },
      );
    });

    it('accepts exactly one move', () => {
      expect(validateProposalInput([move()], limits()).ok).toBe(true);
    });
  });

  describe('too-many-operations (req 1.7)', () => {
    it('accepts exactly the maximum', () => {
      const ops = Array.from({ length: 3 }, () => edit());
      expect(validateProposalInput(ops, limits({ maxOperations: 3 })).ok).toBe(
        true,
      );
    });

    it('rejects one over the maximum and reports the maximum', () => {
      const ops = Array.from({ length: 4 }, () => edit());
      expect(validateProposalInput(ops, limits({ maxOperations: 3 }))).toEqual({
        ok: false,
        rejection: { code: 'too-many-operations', max: 3 },
      });
    });

    it('does not check the count when the maximum is null', () => {
      const ops = Array.from({ length: 500 }, () => edit());
      expect(
        validateProposalInput(ops, limits({ maxOperations: null })).ok,
      ).toBe(true);
    });
  });

  describe('body-too-large (req 1.16)', () => {
    it('accepts a total exactly at the limit', () => {
      const ops = [edit('a'.repeat(5)), create('/p', 'b'.repeat(5))];
      expect(
        validateProposalInput(ops, limits({ maxTotalBodyBytes: 10 })).ok,
      ).toBe(true);
    });

    it('rejects when the total is one byte over, summing across operations', () => {
      const ops = [edit('a'.repeat(5)), create('/p', 'b'.repeat(6))];
      expect(
        validateProposalInput(ops, limits({ maxTotalBodyBytes: 10 })),
      ).toEqual({ ok: false, rejection: { code: 'body-too-large' } });
    });

    it('measures UTF-8 bytes, not characters', () => {
      // 4 Japanese characters = 12 bytes
      expect(
        validateProposalInput(
          [edit('あいうえ')],
          limits({ maxTotalBodyBytes: 11 }),
        ),
      ).toEqual({ ok: false, rejection: { code: 'body-too-large' } });
    });

    describe('with Japanese and emoji bodies', () => {
      it.each([
        ['4 Japanese characters', 'あいうえ', 12],
        ['a CRLF-separated Japanese body', '日本語\r\n本文', 17],
        ['an emoji (a surrogate pair in UTF-16)', '😀', 4],
        ['Japanese, ASCII and emoji mixed', 'ページa😀', 14],
      ])('accepts %s exactly at its UTF-8 byte size and rejects it one byte below', (_label, body, bytes) => {
        expect(
          validateProposalInput(
            [edit(body)],
            limits({ maxTotalBodyBytes: bytes }),
          ).ok,
        ).toBe(true);
        expect(
          validateProposalInput(
            [edit(body)],
            limits({ maxTotalBodyBytes: bytes - 1 }),
          ),
        ).toEqual({ ok: false, rejection: { code: 'body-too-large' } });
      });

      it('sums Japanese bodies across edit and create operations', () => {
        // 9 + 6 = 15 bytes
        const ops = [edit('日本語'), create('/日本語/新規', 'ペー')];
        expect(
          validateProposalInput(ops, limits({ maxTotalBodyBytes: 15 })).ok,
        ).toBe(true);
        expect(
          validateProposalInput(ops, limits({ maxTotalBodyBytes: 14 })),
        ).toEqual({ ok: false, rejection: { code: 'body-too-large' } });
      });

      it('accepts a Japanese body of exactly 8 MiB and rejects one more byte', () => {
        // 2,796,202 characters × 3 bytes + 2 bytes = 8,388,608 bytes
        const atLimit = `${'あ'.repeat(2_796_202)}ab`;
        expect(validateProposalInput([edit(atLimit)], limits()).ok).toBe(true);
        expect(validateProposalInput([edit(`${atLimit}c`)], limits())).toEqual({
          ok: false,
          rejection: { code: 'body-too-large' },
        });
      });
    });

    it('does not count move operations as body', () => {
      expect(
        validateProposalInput([move()], limits({ maxTotalBodyBytes: 0 })).ok,
      ).toBe(true);
    });

    it('rejects a body over the 8 MiB default constant', () => {
      expect(
        validateProposalInput(
          [edit('a'.repeat(MAX_TOTAL_BODY_BYTES + 1))],
          limits(),
        ),
      ).toEqual({ ok: false, rejection: { code: 'body-too-large' } });
    });
  });

  describe('operation-type-disabled (req 1.9)', () => {
    it('rejects the first operation whose type is not enabled', () => {
      const enabled = new Set<CreatableOperationType>(['edit']);
      expect(
        validateProposalInput(
          [edit(), create(), move()],
          limits({ enabledOperationTypes: enabled }),
        ),
      ).toEqual({
        ok: false,
        rejection: { code: 'operation-type-disabled', index: 1 },
      });
    });

    it('rejects everything when no type is enabled', () => {
      expect(
        validateProposalInput(
          [edit()],
          limits({ enabledOperationTypes: new Set() }),
        ),
      ).toEqual({
        ok: false,
        rejection: { code: 'operation-type-disabled', index: 0 },
      });
    });
  });

  describe('invalid-path (req 1.13)', () => {
    it.each([
      '',
      'no-leading-slash',
      '/with?query',
      '/a//b',
      '/trash/x',
      '/admin/x',
      '/user',
      '/page.md',
      '/a/../b',
      '/with#hash',
    ])('rejects create path %j', (path) => {
      expect(validateProposalInput([create(path)], limits())).toEqual({
        ok: false,
        rejection: { code: 'invalid-path', index: 0 },
      });
    });

    it('rejects an unusable move destination with its index', () => {
      expect(
        validateProposalInput([edit(), move('/trash/x')], limits()),
      ).toEqual({ ok: false, rejection: { code: 'invalid-path', index: 1 } });
    });

    it.each([
      '/日本語/ページ　全角空白',
      '/テスト/プロポーザル（かっこ）',
      '/日本語/a.b(1)[仮]{2}|x　y',
      '/絵文字😀/ページ',
    ])('accepts the Japanese path %j as a create path and a move destination', (path) => {
      expect(
        validateProposalInput([create(path), move(path)], limits()).ok,
      ).toBe(true);
    });

    it.each([
      '/日本語/a.b+c(d)',
      '/日本語/a^b',
      '/日本語/ページ.md',
      '/trash/日本語',
    ])('rejects the Japanese path %j that GROWI cannot create', (path) => {
      expect(validateProposalInput([create(path)], limits())).toEqual({
        ok: false,
        rejection: { code: 'invalid-path', index: 0 },
      });
    });

    it.each([
      '/dup-1/',
      '/a/b/',
      '/日本語/ページ/',
      '/a/b//',
    ])('rejects the trailing-slash path %j as a create path and a move destination', (path) => {
      expect(validateProposalInput([create(path)], limits())).toEqual({
        ok: false,
        rejection: { code: 'invalid-path', index: 0 },
      });
      expect(validateProposalInput([edit(), move(path)], limits())).toEqual({
        ok: false,
        rejection: { code: 'invalid-path', index: 1 },
      });
    });

    // '/' is already canonical; the always-present root page makes the
    // occupied-path checks refuse it later.
    it('does not treat the root path as a trailing-slash path', () => {
      expect(validateProposalInput([create('/'), move('/')], limits()).ok).toBe(
        true,
      );
    });

    it('accepts ordinary paths including non-ASCII and user pages', () => {
      expect(
        validateProposalInput(
          [create('/日本語/ページ'), create('/user/alice/memo')],
          limits(),
        ).ok,
      ).toBe(true);
    });
  });

  describe('check order', () => {
    it('reports empty before anything else', () => {
      expect(
        validateProposalInput([], limits({ enabledOperationTypes: new Set() })),
      ).toEqual({ ok: false, rejection: { code: 'empty-operations' } });
    });

    it('reports an unsupported type before a move/count/size problem', () => {
      const bad = { type: 'trash' } as unknown as CreatableOperationInput;
      expect(
        validateProposalInput(
          [move('/a'), move('/b'), bad],
          limits({ maxOperations: 1 }),
        ),
      ).toEqual({
        ok: false,
        rejection: { code: 'unsupported-operation-type', index: 2 },
      });
    });

    it('reports disabled type before an invalid path', () => {
      expect(
        validateProposalInput(
          [create('/trash/x')],
          limits({ enabledOperationTypes: new Set(['edit']) }),
        ),
      ).toEqual({
        ok: false,
        rejection: { code: 'operation-type-disabled', index: 0 },
      });
    });
  });

  it('does not mutate its input', () => {
    const ops = Object.freeze([Object.freeze(edit())]);
    expect(validateProposalInput(ops, limits()).ok).toBe(true);
  });
});
