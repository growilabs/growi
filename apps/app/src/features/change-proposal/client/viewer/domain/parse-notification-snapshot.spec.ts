import { SupportedAction } from '~/interfaces/activity';

import type {
  ChangeProposalNotificationSnapshot,
  ChangeProposalRevertRequestSnapshot,
} from '../../../interfaces';
import { parseChangeProposalNotification } from './parse-notification-snapshot';

const PROPOSAL_ID = '65a1b2c3d4e5f60718293a4b';

const coalesced = (
  kind: 'apply' | 'revert',
): ChangeProposalNotificationSnapshot => ({
  proposalId: PROPOSAL_ID,
  entry: 'mcp',
  kind,
  requester: { id: '65a1b2c3d4e5f60718293a4c', username: 'alice' },
  pages: [
    { id: '65a1b2c3d4e5f60718293a4d', path: '/a' },
    { id: '65a1b2c3d4e5f60718293a4e', path: '/b/c' },
  ],
});

const revertRequest: ChangeProposalRevertRequestSnapshot = {
  proposalId: PROPOSAL_ID,
  kind: 'revert-request',
  sender: { id: '65a1b2c3d4e5f60718293a4f', username: 'bob' },
  message: 'please <b>revert</b>',
};

const APPLY = SupportedAction.ACTION_CHANGE_PROPOSAL_APPLY;
const REVERT = SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT;
const REVERT_REQUEST = SupportedAction.ACTION_CHANGE_PROPOSAL_REVERT_REQUEST;

describe('parseChangeProposalNotification', () => {
  describe('valid snapshots', () => {
    it.each([
      [APPLY, 'apply'],
      [REVERT, 'revert'],
    ] as const)('reads a coalesced snapshot for %s', (action, kind) => {
      expect(
        parseChangeProposalNotification(
          action,
          JSON.stringify(coalesced(kind)),
        ),
      ).toEqual({
        kind,
        proposalId: PROPOSAL_ID,
        actorUsername: 'alice',
        pagePaths: ['/a', '/b/c'],
      });
    });

    it('accepts a coalesced snapshot without pages', () => {
      expect(
        parseChangeProposalNotification(
          APPLY,
          JSON.stringify({ ...coalesced('apply'), pages: [] }),
        ),
      ).toEqual({
        kind: 'apply',
        proposalId: PROPOSAL_ID,
        actorUsername: 'alice',
        pagePaths: [],
      });
    });

    it('reads a revert-request snapshot, keeping the message verbatim', () => {
      expect(
        parseChangeProposalNotification(
          REVERT_REQUEST,
          JSON.stringify(revertRequest),
        ),
      ).toEqual({
        kind: 'revert-request',
        proposalId: PROPOSAL_ID,
        senderUsername: 'bob',
        message: 'please <b>revert</b>',
      });
    });

    it('accepts an empty revert-request message', () => {
      expect(
        parseChangeProposalNotification(
          REVERT_REQUEST,
          JSON.stringify({ ...revertRequest, message: '' }),
        ),
      ).toMatchObject({ message: '' });
    });

    it('ignores unexpected extra fields', () => {
      const parsed = parseChangeProposalNotification(
        APPLY,
        JSON.stringify({ ...coalesced('apply'), extra: 1 }),
      );
      expect(parsed).toEqual({
        kind: 'apply',
        proposalId: PROPOSAL_ID,
        actorUsername: 'alice',
        pagePaths: ['/a', '/b/c'],
      });
    });
  });

  describe('malformed input returns null without throwing', () => {
    it.each([
      ['empty string', ''],
      ['not JSON', '{not json'],
      ['undefined', undefined],
      ['null', null],
      ['a number', 1],
      ['an object (not a string)', coalesced('apply')],
      ['JSON null', 'null'],
      ['JSON array', '[]'],
      ['JSON string', '"x"'],
    ])('%s', (_label, snapshot) => {
      expect(parseChangeProposalNotification(APPLY, snapshot)).toBeNull();
      expect(
        parseChangeProposalNotification(REVERT_REQUEST, snapshot),
      ).toBeNull();
    });

    it('unknown action', () => {
      expect(
        parseChangeProposalNotification(
          'CHANGE_PROPOSAL_CREATE',
          JSON.stringify(coalesced('apply')),
        ),
      ).toBeNull();
      expect(
        parseChangeProposalNotification('', JSON.stringify(coalesced('apply'))),
      ).toBeNull();
    });

    it.each([
      ['not 24 hex', 'abc'],
      ['non-hex characters', 'zzzzzzzzzzzzzzzzzzzzzzzz'],
      ['empty', ''],
      ['not a string', 123],
    ])('invalid proposalId: %s', (_label, proposalId) => {
      expect(
        parseChangeProposalNotification(
          APPLY,
          JSON.stringify({ ...coalesced('apply'), proposalId }),
        ),
      ).toBeNull();
      expect(
        parseChangeProposalNotification(
          REVERT_REQUEST,
          JSON.stringify({ ...revertRequest, proposalId }),
        ),
      ).toBeNull();
    });

    it.each([
      ['missing proposalId', { ...coalesced('apply'), proposalId: undefined }],
      ['missing requester', { ...coalesced('apply'), requester: undefined }],
      ['requester without username', { ...coalesced('apply'), requester: {} }],
      [
        'requester username not a string',
        { ...coalesced('apply'), requester: { id: 'x', username: 1 } },
      ],
      ['missing pages', { ...coalesced('apply'), pages: undefined }],
      ['pages not an array', { ...coalesced('apply'), pages: 'x' }],
      ['page without path', { ...coalesced('apply'), pages: [{ id: 'x' }] }],
      ['page is null', { ...coalesced('apply'), pages: [null] }],
      [
        'page path not a string',
        { ...coalesced('apply'), pages: [{ path: 1 }] },
      ],
    ])('coalesced shape: %s', (_label, snapshot) => {
      expect(
        parseChangeProposalNotification(APPLY, JSON.stringify(snapshot)),
      ).toBeNull();
    });

    it.each([
      ['missing sender', { ...revertRequest, sender: undefined }],
      ['sender without username', { ...revertRequest, sender: {} }],
      [
        'sender username not a string',
        { ...revertRequest, sender: { id: 'x', username: 1 } },
      ],
      ['missing message', { ...revertRequest, message: undefined }],
      ['message not a string', { ...revertRequest, message: 1 }],
    ])('revert-request shape: %s', (_label, snapshot) => {
      expect(
        parseChangeProposalNotification(
          REVERT_REQUEST,
          JSON.stringify(snapshot),
        ),
      ).toBeNull();
    });

    it('does not read a revert-request snapshot as a coalesced one, or vice versa', () => {
      expect(
        parseChangeProposalNotification(APPLY, JSON.stringify(revertRequest)),
      ).toBeNull();
      expect(
        parseChangeProposalNotification(
          REVERT_REQUEST,
          JSON.stringify(coalesced('apply')),
        ),
      ).toBeNull();
    });
  });
});
