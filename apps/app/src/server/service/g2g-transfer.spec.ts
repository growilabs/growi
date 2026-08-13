import { Readable } from 'node:stream';
// biome-ignore lint/style/noRestrictedImports: startTransfer's archive POST calls rawAxios directly, so the spy must attach to that same singleton instance.
import rawAxios, { type AxiosResponse } from 'axios';
import type { Namespace } from 'socket.io';
import { mock } from 'vitest-mock-extended';

import { G2G_PROGRESS_STATUS } from '~/interfaces/g2g-transfer';
import type Crowi from '~/server/crowi';
import {
  G2G_DATA_CONFLICT_ERROR_CODE,
  G2G_IMPORT_IN_PROGRESS_ERROR_CODE,
  G2G_MIXED_IMPORT_MODES_ERROR_CODE,
  G2G_PROTECTED_COLLECTION_ERROR_CODE,
  G2GTransferErrorCode,
} from '~/server/models/vo/g2g-transfer-error';
import axios from '~/utils/axios';
import { TransferKey } from '~/utils/vo/transfer-key';

import {
  computePasswordSeedFingerprint,
  G2GTransferPusherService,
  type IDataGROWIInfo,
  readPostProcessFailures,
  readRescueApplied,
  readRescueOutcome,
  toArchivePostErrorEvent,
  toTransferability,
} from './g2g-transfer';
import type { TransferBlocker } from './g2g-transfer-transferability';
import {
  describeBlocker,
  evaluateTransferability,
} from './g2g-transfer-transferability';

// `startTransfer` streams the exported archive to `form-data` and never reads it back
// in these tests (the POST itself is mocked below), so a real file is unnecessary.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    createReadStream: vi.fn(() => Readable.from([])),
  };
});

// Keeps `startTransfer` past the zip-generation phase so the test can drive the archive
// POST catch specifically, without depending on the real export pipeline.
vi.mock('./export', () => ({
  exportService: {
    export: vi.fn().mockResolvedValue({ zipFilePath: '/fake/archive.zip' }),
  },
}));

// `configManager.getConfig` throws ("Config is not loaded") unless `loadConfigs()` ran
// first; startTransfer only uses it to build upload-config metadata that this test does
// not inspect, so a stub avoiding that throw is enough.
vi.mock('./config-manager', () => ({
  configManager: { getConfig: vi.fn() },
}));

// The custom axios instance is the pusher's other network boundary (the archive POST goes
// through `rawAxios`): the transfer key keep-alive and the attachment phase's "which
// files do you already have?" both go through it. Left real, the attachment phase in the
// test below would try to reach dest.example.com for real.
vi.mock('~/utils/axios', () => ({
  default: { get: vi.fn(), post: vi.fn() },
}));

const GENERIC_EVENT = {
  key: 'admin:g2g:error_send_growi_archive',
  message: 'Failed to send GROWI archive file to the destination GROWI',
};

describe('toArchivePostErrorEvent', () => {
  test('maps a growi_data_conflict response to the data-conflict event, carrying the conflict summary as-is', () => {
    // Requirements 2.2, 3.1, 3.2 — the operator-facing message is the receiver's own
    // conflict summary, unmodified (no truncation, no rewording).
    const conflictSummary =
      'users: 2 conflicts (email: "admin@example.com", "ops@example.com")';
    const err = {
      response: {
        status: 409,
        data: {
          errors: [
            { message: conflictSummary, code: G2G_DATA_CONFLICT_ERROR_CODE },
          ],
        },
      },
    };

    expect(toArchivePostErrorEvent(err)).toEqual({
      key: 'admin:g2g:error_data_conflict',
      message: conflictSummary,
    });
  });

  test('maps an import_already_in_progress response to its own event', () => {
    // Requirement 2.7 — "the destination is busy, retry later" is something the operator
    // can act on, and the generic "failed to send the archive" is not.
    const busyMessage = 'Another import is already running on this GROWI.';
    const err = {
      response: {
        status: 409,
        data: {
          errors: [
            { message: busyMessage, code: G2G_IMPORT_IN_PROGRESS_ERROR_CODE },
          ],
        },
      },
    };

    expect(toArchivePostErrorEvent(err)).toEqual({
      key: 'admin:g2g:error_import_in_progress',
      message: busyMessage,
    });
  });

  test('maps a protected_collection_included response to its own event', () => {
    // Requirements 5.7, 5.8 — the push side drops the collections a transfer must not
    // carry before the archive is built, so this answer means the two GROWIs disagree
    // about which those are. The generic "failed to send the archive" hides exactly the
    // fact that says so: the receiver's message names the collections it refused.
    const refusalMessage =
      'These collections must not be transferred: transferkeys, sessions';
    const err = {
      response: {
        status: 400,
        data: {
          errors: [
            {
              message: refusalMessage,
              code: G2G_PROTECTED_COLLECTION_ERROR_CODE,
            },
          ],
        },
      },
    };

    expect(toArchivePostErrorEvent(err)).toEqual({
      key: 'admin:g2g:error_protected_collection',
      message: refusalMessage,
    });
  });

  test('maps a mixed_import_modes response to its own event', () => {
    // Requirement 1.5 — this answer means the request's import-method assignment mixed
    // replacing some collections with appending to others, which the receive route
    // refused before writing anything. The generic "failed to send the archive" would
    // hide that specific disagreement between the two GROWIs.
    const refusalMessage =
      'The import-method assignment must either replace every collection or replace none of them.';
    const err = {
      response: {
        status: 400,
        data: {
          errors: [
            {
              message: refusalMessage,
              code: G2G_MIXED_IMPORT_MODES_ERROR_CODE,
            },
          ],
        },
      },
    };

    expect(toArchivePostErrorEvent(err)).toEqual({
      key: 'admin:g2g:error_mixed_import_methods',
      message: refusalMessage,
    });
  });

  test('maps a conflict_detection_failed response to its own event, not the generic one', () => {
    // The receive route ran and refused to guess whether the archive conflicts (issue
    // #10151) -- that must read differently from a dropped connection, which is what the
    // generic event otherwise looks identical to.
    const detectionFailureMessage =
      'Failed to detect data conflicts before import.';
    const err = {
      response: {
        status: 500,
        data: {
          errors: [
            {
              message: detectionFailureMessage,
              code: 'conflict_detection_failed',
            },
          ],
        },
      },
    };

    expect(toArchivePostErrorEvent(err)).toEqual({
      key: 'admin:g2g:error_conflict_detection_failed',
      message: detectionFailureMessage,
    });
  });

  test.each<[string, string, string]>([
    [
      'invalid_transfer_key',
      'Invalid transfer key',
      'admin:g2g:error_invalid_transfer_key',
    ],
    [
      'parse_failed',
      'Failed to parse request body.',
      'admin:g2g:error_parse_failed',
    ],
    [
      'validation_failed',
      'Failed to validate transfer data file.',
      'admin:g2g:error_validation_failed',
    ],
    [
      'version_incompatible',
      'The version of this GROWI and the uploaded GROWI data are not the same',
      'admin:g2g:error_version_incompatible',
    ],
    [
      'import_settings_invalid',
      'Import settings are invalid. See GROWI docs about details.',
      'admin:g2g:error_import_settings_invalid',
    ],
    [
      'mongo_collection_import_failure',
      'Failed to import MongoDB collections',
      'admin:g2g:error_mongo_collection_import_failure',
    ],
  ])('maps a %s response to its own event', (code, message, key) => {
    const err = {
      response: {
        status: 500,
        data: { errors: [{ message, code }] },
      },
    };

    expect(toArchivePostErrorEvent(err)).toEqual({ key, message });
  });

  test('falls back to the generic event for a network error carrying no response at all', () => {
    expect(toArchivePostErrorEvent(new Error('ECONNREFUSED'))).toEqual(
      GENERIC_EVENT,
    );
  });

  test.each<[string, unknown]>([
    ['err is null', null],
    ['err is a plain thrown string', 'some non-Error throw'],
    [
      'response.data is a string, not an envelope object',
      { response: { data: 'Internal Server Error' } },
    ],
    ['errors is missing from the envelope', { response: { data: {} } }],
    ['errors is an empty array', { response: { data: { errors: [] } } }],
    [
      'errors[0] is not an object',
      { response: { data: { errors: ['oops'] } } },
    ],
    [
      'errors[0].message is missing',
      {
        response: {
          data: { errors: [{ code: G2G_DATA_CONFLICT_ERROR_CODE }] },
        },
      },
    ],
    [
      'errors[0].message is not a string even though the code matches',
      {
        response: {
          data: {
            errors: [{ code: G2G_DATA_CONFLICT_ERROR_CODE, message: 42 }],
          },
        },
      },
    ],
  ])('falls back to the generic event without throwing when %s', (_label, err) => {
    expect(() => toArchivePostErrorEvent(err)).not.toThrow();
    expect(toArchivePostErrorEvent(err)).toEqual(GENERIC_EVENT);
  });
});

describe('toTransferability', () => {
  test('allows the transfer when there are no blockers', () => {
    expect(toTransferability([])).toEqual({
      canTransfer: true,
    });
  });

  test('refuses the transfer with the first blocker described, when there is exactly one', () => {
    const blocker: TransferBlocker = {
      type: 'destination_storage_not_writable',
    };

    expect(toTransferability([blocker])).toEqual({
      canTransfer: false,
      reason: describeBlocker(blocker),
    });
  });

  test('reports only the first blocker when several apply, matching the old early-return priority', () => {
    // The pre-existing checks were a sequence of early returns, so a caller reading
    // `reason` only ever saw the earliest applicable one. `evaluateBlockers` reports
    // every applicable blocker (so a preflight screen can show them all), but this
    // legacy shape still has room for exactly one message.
    const first: TransferBlocker = {
      type: 'version_mismatch',
      src: '7.5.0',
      dest: '7.4.0',
    };
    const second: TransferBlocker = {
      type: 'destination_storage_not_writable',
    };

    const result = toTransferability([first, second]);

    expect(result).toEqual({
      canTransfer: false,
      reason: describeBlocker(first),
    });
    if (!result.canTransfer) {
      expect(result.reason).not.toBe(describeBlocker(second));
    }
  });
});

describe('computePasswordSeedFingerprint', () => {
  // Requirement 3.6 — the two GROWIs have to find out whether their password seeds
  // agree, and the seed is what every user's password hash is derived from, so the only
  // thing allowed on the wire is something that answers "same or not" and nothing else.
  const SEED = 'a-destination-password-seed';

  test('gives away nothing of the seed it was computed from', () => {
    const fingerprint = computePasswordSeedFingerprint(SEED);

    expect(fingerprint).not.toContain(SEED);
    // A fixed-length hex digest: whatever the seed was, its length is not observable
    // from the fingerprint either.
    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(
      computePasswordSeedFingerprint(`${SEED}-and-then-some-more`),
    ).toMatch(/^[0-9a-f]{64}$/);
  });

  test('matches for equal seeds and differs for unequal ones, which is the whole comparison', () => {
    expect(computePasswordSeedFingerprint(SEED)).toBe(
      computePasswordSeedFingerprint(SEED),
    );
    expect(computePasswordSeedFingerprint(SEED)).not.toBe(
      computePasswordSeedFingerprint('a-source-password-seed'),
    );
    // One character apart still has to read as "different", or migrated users are told
    // their passwords survive when they do not.
    expect(computePasswordSeedFingerprint(SEED)).not.toBe(
      computePasswordSeedFingerprint(`${SEED}x`),
    );
  });

  test('treats a GROWI started without PASSWORD_SEED as one more seed value', () => {
    // `generatePassword` hashes `crowi.env.PASSWORD_SEED + password`, so an unset seed
    // still produces hashes two such GROWIs share — and hashes a GROWI with a real seed
    // does not. Reporting "no fingerprint" instead would either warn every unset-seed
    // transfer or, worse, match a GROWI that has one.
    expect(computePasswordSeedFingerprint(undefined)).toBe(
      computePasswordSeedFingerprint(undefined),
    );
    expect(computePasswordSeedFingerprint(undefined)).not.toBe(
      computePasswordSeedFingerprint(SEED),
    );
  });
});

describe('readRescueOutcome', () => {
  test('reads a rescue outcome carrying only what the operator is told, from the response body', () => {
    // Requirements 4.6, 4.10 — the renamed username, what was dropped, and whether the
    // identifier was reassigned all have to survive the read.
    const responseData = {
      rescue: {
        rescued: [
          {
            originalUsername: 'admin',
            rescuedUsername: 'admin-rescued',
            emailRemoved: true,
            slackMemberIdRemoved: false,
            idReassigned: true,
          },
        ],
      },
    };

    expect(readRescueOutcome(responseData)).toEqual({
      rescued: [
        {
          originalUsername: 'admin',
          rescuedUsername: 'admin-rescued',
          emailRemoved: true,
          slackMemberIdRemoved: false,
          idReassigned: true,
        },
      ],
    });
  });

  test('returns null when the transfer did not replace users at all (rescue: null)', () => {
    expect(readRescueOutcome({ rescue: null })).toBeNull();
  });

  test.each<[string, unknown]>([
    ['responseData is not an object', 'Internal Server Error'],
    ['responseData has no rescue field', {}],
    ['rescue is a string, not an object', { rescue: 'nope' }],
    ['rescue.rescued is missing', { rescue: {} }],
    ['rescue.rescued is not an array', { rescue: { rescued: 'nope' } }],
  ])('falls back to null without throwing when %s (an older/malformed destination)', (_label, responseData) => {
    expect(() => readRescueOutcome(responseData)).not.toThrow();
    expect(readRescueOutcome(responseData)).toBeNull();
  });

  test('drops a malformed entry instead of letting it through with undefined fields', () => {
    const responseData = {
      rescue: {
        rescued: [
          {
            originalUsername: 'admin',
            rescuedUsername: 'admin-rescued',
            emailRemoved: true,
            slackMemberIdRemoved: false,
            idReassigned: true,
          },
          // Missing `idReassigned` -- not a real RescuedAdminSummary.
          {
            originalUsername: 'ops',
            rescuedUsername: 'ops',
            emailRemoved: false,
            slackMemberIdRemoved: false,
          },
        ],
      },
    };

    expect(readRescueOutcome(responseData)).toEqual({
      rescued: [
        {
          originalUsername: 'admin',
          rescuedUsername: 'admin-rescued',
          emailRemoved: true,
          slackMemberIdRemoved: false,
          idReassigned: true,
        },
      ],
    });
  });

  test('projects a surviving entry to exactly the five fields the operator is told, dropping anything extra', () => {
    // The re-insertion payload this travels alongside on the destination carries a
    // password hash, an `apiToken` and access-token `tokenHash`es -- none of which may
    // ever reach this response body in the first place (that boundary is task 9.3's).
    // This test is about a *different* risk: even restricted to a plain object shaped
    // like RescuedAdminSummary, passing the destination's object through by reference
    // (rather than rebuilding it field-by-field) would let any extra property the
    // destination attached ride along untouched into the socket payload the source
    // operator's browser receives.
    const responseData = {
      rescue: {
        rescued: [
          {
            originalUsername: 'admin',
            rescuedUsername: 'admin-rescued',
            emailRemoved: true,
            slackMemberIdRemoved: false,
            idReassigned: true,
            // Must never survive the read, whatever it is.
            apiToken: 'leaked-api-token',
            passwordHash: 'leaked-password-hash',
          },
        ],
      },
    };

    const result = readRescueOutcome(responseData);

    expect(result?.rescued[0]).toEqual({
      originalUsername: 'admin',
      rescuedUsername: 'admin-rescued',
      emailRemoved: true,
      slackMemberIdRemoved: false,
      idReassigned: true,
    });
  });
});

describe('readRescueApplied', () => {
  test('reads false when the destination reports the rescue was not written back', () => {
    expect(readRescueApplied({ rescueApplied: false })).toBe(false);
  });

  test('reads true when the destination reports the rescue was written back', () => {
    expect(readRescueApplied({ rescueApplied: true })).toBe(true);
  });

  test.each<[string, unknown]>([
    ['the field is absent', {}],
    ['responseData is not an object', 'Internal Server Error'],
    ['responseData is null', null],
  ])('reads true (the best case) when %s, matching what every destination reported before this field existed', (_label, responseData) => {
    expect(readRescueApplied(responseData)).toBe(true);
  });
});

describe('readPostProcessFailures', () => {
  test('reads the labels of the failed clean-up steps', () => {
    expect(
      readPostProcessFailures({
        postProcessFailures: ['restore-upload-configs', 'invalidate-sessions'],
      }),
    ).toEqual(['restore-upload-configs', 'invalidate-sessions']);
  });

  test('reads an empty list when nothing failed', () => {
    expect(readPostProcessFailures({ postProcessFailures: [] })).toEqual([]);
  });

  test.each<[string, unknown]>([
    ['the field is absent', {}],
    ['responseData is not an object', 'Internal Server Error'],
    ['postProcessFailures is not an array', { postProcessFailures: 'nope' }],
  ])('reads an empty list when %s (an older/malformed destination)', (_label, responseData) => {
    expect(() => readPostProcessFailures(responseData)).not.toThrow();
    expect(readPostProcessFailures(responseData)).toEqual([]);
  });

  test('drops a non-string entry instead of letting it through', () => {
    expect(
      readPostProcessFailures({
        postProcessFailures: ['real-label', 42, null],
      }),
    ).toEqual(['real-label']);
  });
});

describe('the destination report as the transfer judgement reads it', () => {
  test('every warning the destination is responsible for is decided by a field of its own report', () => {
    // Requirements 3.4, 3.5, 3.7 — what the destination answers *is* the judgement's
    // input, so `IDataGROWIInfo` has to satisfy `TransferabilityDestination` outright.
    // The type check is the real guard here: drop or rename one of the three fields and
    // this call stops compiling, instead of the warning quietly never firing.
    const destination: IDataGROWIInfo = {
      version: '8.0.0',
      userUpperLimit: null,
      fileUploadTotalLimit: null,
      attachmentInfo: { type: 'aws', writable: true },
      destinationCounts: { users: 12, userGroups: 3, pages: 340 },
      passwordSeedFingerprint: 'a-destination-fingerprint',
      loginableAdminCount: 0,
      sessionStoreSupportsEnumeration: false,
    };

    const { warnings } = evaluateTransferability(
      {
        version: '8.0.0',
        activeUsers: 1,
        totalFileSize: 0,
        fileUploadType: 'aws',
        passwordSeedFingerprint: 'a-source-fingerprint',
        isLocalAuthEnabled: true,
      },
      destination,
    );

    expect(warnings).toEqual([
      { type: 'password_seed_mismatch' },
      { type: 'no_loginable_admin' },
      { type: 'sessions_not_invalidatable' },
    ]);
  });
});

const tk = new TransferKey('https://dest.example.com', 'test-transfer-key');

const buildCrowiAndSocket = (): { crowi: Crowi; socket: Namespace } => {
  const socket = mock<Namespace>();
  const crowi = mock<Crowi>({
    appService: { getAppTitle: () => 'Test GROWI' },
    socketIoService: { getAdminSocket: () => socket },
  });
  return { crowi, socket };
};

describe('G2GTransferPusherService.startTransfer archive POST failure', () => {
  test('emits the data-conflict admin:g2gError and rethrows when the receiver reports growi_data_conflict', async () => {
    const { crowi, socket } = buildCrowiAndSocket();
    const pusher = new G2GTransferPusherService(crowi);
    const conflictSummary = 'usergroups: 1 conflict (name: "engineering")';

    // Identity-checked below via `.rejects.toBe(thrownErr)`, so this proves the
    // rejection is this specific archive-POST failure re-thrown, not merely "some
    // rejection" from whatever runs next (e.g. `transferAttachments`) if `throw err`
    // were ever dropped from the catch.
    const thrownErr = {
      response: {
        status: 409,
        data: {
          errors: [
            { message: conflictSummary, code: G2G_DATA_CONFLICT_ERROR_CODE },
          ],
        },
      },
    };
    vi.spyOn(rawAxios, 'post').mockRejectedValueOnce(thrownErr);

    await expect(
      pusher.startTransfer(
        tk,
        { _id: 'operator-id' },
        ['pages'],
        {},
        mock<IDataGROWIInfo>(),
      ),
    ).rejects.toBe(thrownErr);

    expect(socket.emit).toHaveBeenCalledWith('admin:g2gProgress', {
      mongo: G2G_PROGRESS_STATUS.ERROR,
      attachments: G2G_PROGRESS_STATUS.PENDING,
    });
    expect(socket.emit).toHaveBeenCalledWith('admin:g2gError', {
      key: 'admin:g2g:error_data_conflict',
      message: conflictSummary,
    });
  });

  test('emits the existing generic admin:g2gError and rethrows for any other archive POST failure', async () => {
    const { crowi, socket } = buildCrowiAndSocket();
    const pusher = new G2GTransferPusherService(crowi);

    const thrownErr = new Error('socket hang up');
    vi.spyOn(rawAxios, 'post').mockRejectedValueOnce(thrownErr);

    await expect(
      pusher.startTransfer(
        tk,
        { _id: 'operator-id' },
        ['pages'],
        {},
        mock<IDataGROWIInfo>(),
      ),
    ).rejects.toBe(thrownErr);

    expect(socket.emit).toHaveBeenCalledWith('admin:g2gProgress', {
      mongo: G2G_PROGRESS_STATUS.ERROR,
      attachments: G2G_PROGRESS_STATUS.PENDING,
    });
    expect(socket.emit).toHaveBeenCalledWith('admin:g2gError', GENERIC_EVENT);
  });
});

describe('G2GTransferPusherService.startTransfer partly failed import', () => {
  const failedCollections = ['pagetagrelations'];

  /**
   * A destination that finished importing and could not read one collection: it answers
   * 200 (it did finish trying), and names the collection in the body.
   */
  const mockPartiallyFailedArchiveResponse = (): void => {
    vi.spyOn(rawAxios, 'post').mockResolvedValueOnce(
      mock<AxiosResponse>({ data: { failedCollections } }),
    );
  };

  test('reports the import failure even when the attachment transfer that follows it fails', async () => {
    const { crowi, socket } = buildCrowiAndSocket();
    const pusher = new G2GTransferPusherService(crowi);

    mockPartiallyFailedArchiveResponse();
    // The attachment phase opens by asking the destination which files it already holds,
    // so failing that request fails the whole phase — the shortest way to reach the
    // attachment catch without a storage backend.
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(
      pusher.startTransfer(
        tk,
        { _id: 'operator-id' },
        ['pages'],
        {},
        mock<IDataGROWIInfo>(),
      ),
    ).rejects.toMatchObject({
      code: G2GTransferErrorCode.FAILED_TO_RETRIEVE_FILE_METADATA,
    });

    expect(socket.emit).toHaveBeenCalledWith('admin:g2gError', {
      message: 'Failed to transfer attachments',
      key: 'admin:g2g:error_upload_attachment',
    });
    // Both facts reach the operator. Only this event names the collections the
    // destination is missing, and a failure to send the files does not make that any less
    // true — reporting one in place of the other would leave the operator repairing the
    // wrong thing.
    expect(socket.emit).toHaveBeenCalledWith('admin:g2gError', {
      key: 'admin:g2g:error_partial_import',
      message: `Collections that could not be imported: ${failedCollections.join(', ')}`,
    });
    expect(socket.emit).toHaveBeenCalledWith('admin:g2gProgress', {
      mongo: G2G_PROGRESS_STATUS.ERROR,
      attachments: G2G_PROGRESS_STATUS.ERROR,
      failedCollections,
    });
    // The mongo phase is never restated as completed once a collection was left out; the
    // admin screen turns `mongo` and `attachments` both COMPLETED into a green
    // "transfer succeeded" toast.
    expect(socket.emit).not.toHaveBeenCalledWith(
      'admin:g2gProgress',
      expect.objectContaining({ mongo: G2G_PROGRESS_STATUS.COMPLETED }),
    );
  });
});

describe('G2GTransferPusherService.startTransfer aborted import', () => {
  /**
   * A destination whose import threw before it could finish. It answers 200 on purpose —
   * the attachments still have to cross (requirement 5.2) — and an import that threw hands
   * back no list of collections, so `failedCollections` is empty and `importAborted` is
   * the only thing that distinguishes this from a transfer where everything arrived.
   */
  const mockAbortedImportArchiveResponse = (): void => {
    vi.spyOn(rawAxios, 'post').mockResolvedValueOnce(
      mock<AxiosResponse>({
        data: { failedCollections: [], importAborted: true },
      }),
    );
  };

  test('reports the failure to the operator although the destination named no collection', async () => {
    const { crowi, socket } = buildCrowiAndSocket();
    const pusher = new G2GTransferPusherService(crowi);

    mockAbortedImportArchiveResponse();
    // The attachment phase opens by asking the destination which files it already holds;
    // failing that is the shortest way past it without a storage backend. What is under
    // test is what the operator is told about the *import*.
    vi.mocked(axios.get).mockRejectedValueOnce(new Error('ECONNRESET'));

    await expect(
      pusher.startTransfer(
        tk,
        { _id: 'operator-id' },
        ['pages'],
        {},
        mock<IDataGROWIInfo>(),
      ),
    ).rejects.toMatchObject({
      code: G2GTransferErrorCode.FAILED_TO_RETRIEVE_FILE_METADATA,
    });

    expect(socket.emit).toHaveBeenCalledWith('admin:g2gError', {
      key: 'admin:g2g:error_partial_import',
      // The wording belongs to task 10.3; what this test fixes is that the operator is
      // told at all.
      message: expect.any(String),
    });
    // Without reading the marker, an empty `failedCollections` reads as a clean import and
    // the admin screen shows the green "transfer succeeded" toast — a destination left in
    // maintenance mode, reported as a success (requirement 2.5).
    expect(socket.emit).not.toHaveBeenCalledWith(
      'admin:g2gProgress',
      expect.objectContaining({ mongo: G2G_PROGRESS_STATUS.COMPLETED }),
    );
  });
});

describe('G2GTransferPusherService.startTransfer rescue outcome', () => {
  const rescueOutcomeFixture = {
    rescued: [
      {
        originalUsername: 'admin',
        rescuedUsername: 'admin-rescued',
        emailRemoved: true,
        slackMemberIdRemoved: false,
        idReassigned: true,
      },
    ],
  };

  test('carries the rescue outcome the destination reported in the completion notification', async () => {
    // Requirements 4.6, 4.10 -- the source is a separate process from the destination
    // that performed the rescue, so this response body is the only place the fact can
    // be read from.
    const { crowi, socket } = buildCrowiAndSocket();
    const pusher = new G2GTransferPusherService(crowi);

    // Not `mock<AxiosResponse>({ data: {...} })` as the sibling tests above use:
    // empirically, passing a nested array of plain objects as an override to
    // `mock<T>()` corrupts it into an array of `undefined` once read through this
    // file's real `startTransfer` -> `readRescueOutcome` path (`Array.isArray` +
    // `.filter()`). Assigning `.data` after construction avoids the override path
    // entirely and needs no cast.
    const archiveResponse = mock<AxiosResponse>();
    archiveResponse.data = {
      failedCollections: [],
      rescue: rescueOutcomeFixture,
      // Matches what the real receiving side sends for a rescue that actually
      // landed (`ImportCollectionsResult.rescueApplied`) -- a fixture that leaves
      // this absent exercises a shape the receiving side never produces.
      rescueApplied: true,
    };
    vi.spyOn(rawAxios, 'post').mockResolvedValueOnce(archiveResponse);
    // Bypasses the real attachment pipeline (the Attachment model and a storage
    // backend): what this test is about is whether the rescue outcome from the archive
    // POST's response body reaches the completion notification, not the attachment
    // phase itself (covered separately above).
    vi.spyOn(pusher, 'transferAttachments').mockResolvedValueOnce();

    await pusher.startTransfer(
      tk,
      { _id: 'operator-id' },
      ['users'],
      {},
      mock<IDataGROWIInfo>(),
    );

    expect(socket.emit).toHaveBeenCalledWith('admin:g2gProgress', {
      mongo: G2G_PROGRESS_STATUS.COMPLETED,
      attachments: G2G_PROGRESS_STATUS.COMPLETED,
      rescue: rescueOutcomeFixture,
    });
  });

  test('omits `rescue` from the notification when the transfer never replaced users', async () => {
    // A transfer that never rescued anyone must keep emitting exactly the payload it
    // did before this field existed, not a `rescue: { rescued: [] }` that reads as
    // "a rescue happened and saved nobody".
    const { crowi, socket } = buildCrowiAndSocket();
    const pusher = new G2GTransferPusherService(crowi);

    vi.spyOn(rawAxios, 'post').mockResolvedValueOnce(
      mock<AxiosResponse>({ data: { failedCollections: [], rescue: null } }),
    );
    vi.spyOn(pusher, 'transferAttachments').mockResolvedValueOnce();

    await pusher.startTransfer(
      tk,
      { _id: 'operator-id' },
      ['pages'],
      {},
      mock<IDataGROWIInfo>(),
    );

    expect(socket.emit).toHaveBeenCalledWith('admin:g2gProgress', {
      mongo: G2G_PROGRESS_STATUS.COMPLETED,
      attachments: G2G_PROGRESS_STATUS.COMPLETED,
    });
    expect(socket.emit).not.toHaveBeenCalledWith(
      'admin:g2gProgress',
      expect.objectContaining({ rescue: expect.anything() }),
    );
  });

  test('stays a success for the exact shape a legacy transfer returns (rescueApplied: false with no rescue planned)', async () => {
    // Pins the case task 10.3's gate found uncovered: `rescueApplied` is only ever
    // set to `true` inside `importCollections`'s `if (rescuePlan != null)` block
    // (server/service/g2g-transfer.ts), so a transfer that never needed a rescue at
    // all -- the ordinary legacy/merge case -- reports `rescueApplied: false` on the
    // wire exactly like a migration whose rescue genuinely failed does. The two
    // sibling tests above never exercise this: the "carries" fixture has
    // `rescueApplied: true` and the "omits" fixture never sets the field, so it
    // silently defaults to `true` -- neither shape is what a real legacy transfer
    // sends. Without `rescueOutcome != null` gating `rescueFailed` (as opposed to
    // `!rescueApplied` alone), this exact response would be misread as a failed
    // rescue and every successful legacy transfer would be notified as one
    // (requirement 6.1).
    const { crowi, socket } = buildCrowiAndSocket();
    const pusher = new G2GTransferPusherService(crowi);

    vi.spyOn(rawAxios, 'post').mockResolvedValueOnce(
      mock<AxiosResponse>({
        data: {
          failedCollections: [],
          rescue: null,
          rescueApplied: false,
          postProcessFailures: [],
        },
      }),
    );
    vi.spyOn(pusher, 'transferAttachments').mockResolvedValueOnce();

    await pusher.startTransfer(
      tk,
      { _id: 'operator-id' },
      ['pages'],
      {},
      mock<IDataGROWIInfo>(),
    );

    expect(socket.emit).toHaveBeenCalledWith('admin:g2gProgress', {
      mongo: G2G_PROGRESS_STATUS.COMPLETED,
      attachments: G2G_PROGRESS_STATUS.COMPLETED,
    });
  });
});

describe('G2GTransferPusherService.startTransfer rescue re-insertion failure', () => {
  // design.md's Integration Tests: "救済の再投入だけを失敗させたとき、保守モードが残り、
  // 押す側の通知が失敗になる" (2.8, 4.8) -- when only the rescue re-insertion fails, the
  // receiving side already keeps maintenance mode and reports `rescueApplied: false`
  // with `rescue: { rescued: [] }` (`ImportCollectionsResult.rescue`'s doc comment);
  // the receiving-side half is pinned by
  // `g2g-transfer-replace-procedure.exclusive.integ.ts:593-615`. What was missing --
  // and is under test here -- is the pusher's own reaction to that response: every
  // collection imported, so `failedCollections` is empty and `importAborted` is
  // false, yet the transfer must still be reported as a failure rather than
  // `mongo: COMPLETED`, because nobody can log into the destination as an
  // administrator any more.
  const mockRescueFailedArchiveResponse = (): void => {
    vi.spyOn(rawAxios, 'post').mockResolvedValueOnce(
      mock<AxiosResponse>({
        data: {
          failedCollections: [],
          importAborted: false,
          rescue: { rescued: [] },
          rescueApplied: false,
          postProcessFailures: ['reinsert-rescued-admins'],
        },
      }),
    );
  };

  test('reports a failure rather than a completed transfer when the rescue could not be written back', async () => {
    const { crowi, socket } = buildCrowiAndSocket();
    const pusher = new G2GTransferPusherService(crowi);

    mockRescueFailedArchiveResponse();
    vi.spyOn(pusher, 'transferAttachments').mockResolvedValueOnce();

    await pusher.startTransfer(
      tk,
      { _id: 'operator-id' },
      ['users'],
      {},
      mock<IDataGROWIInfo>(),
    );

    // The mongo phase must never read as COMPLETED for this response, at any point
    // in the transfer -- not just "eventually corrected".
    expect(socket.emit).not.toHaveBeenCalledWith(
      'admin:g2gProgress',
      expect.objectContaining({ mongo: G2G_PROGRESS_STATUS.COMPLETED }),
    );
    expect(socket.emit).toHaveBeenCalledWith('admin:g2gProgress', {
      mongo: G2G_PROGRESS_STATUS.ERROR,
      attachments: G2G_PROGRESS_STATUS.COMPLETED,
    });
    // And the operator is actually told, not just left to notice the icon.
    expect(socket.emit).toHaveBeenCalledWith(
      'admin:g2gError',
      expect.objectContaining({ key: 'admin:g2g:error_partial_import' }),
    );
    // Nobody is named as rescued: the response's `rescue.rescued` is empty (the
    // receiving side's own fix), so there is nothing to carry even if this code
    // forgot to check `rescueApplied` at all -- see the dedicated test below for the
    // case that isolates that guard.
    expect(socket.emit).not.toHaveBeenCalledWith(
      'admin:g2gProgress',
      expect.objectContaining({ rescue: expect.anything() }),
    );
  });

  test('does not name any rescued account when the destination reports rescueApplied: false, even if it named some in `rescue`', async () => {
    // Isolates the `rescueApplied` guard itself from the receiving side's own fix
    // (an empty `rescue.rescued`): a network boundary must not trust the two fields
    // to always agree, and if this code ever stopped checking `rescueApplied` and
    // only checked whether `rescue.rescued` was non-empty, a malformed or
    // out-of-sync response naming accounts here would report them to the operator
    // as kept, which is exactly what task 10.3's gate finding was about.
    const { crowi, socket } = buildCrowiAndSocket();
    const pusher = new G2GTransferPusherService(crowi);

    const archiveResponse = mock<AxiosResponse>();
    archiveResponse.data = {
      failedCollections: [],
      importAborted: false,
      rescue: {
        rescued: [
          {
            originalUsername: 'admin',
            rescuedUsername: 'admin-rescued',
            emailRemoved: false,
            slackMemberIdRemoved: false,
            idReassigned: false,
          },
        ],
      },
      rescueApplied: false,
      postProcessFailures: ['reinsert-rescued-admins'],
    };
    vi.spyOn(rawAxios, 'post').mockResolvedValueOnce(archiveResponse);
    vi.spyOn(pusher, 'transferAttachments').mockResolvedValueOnce();

    await pusher.startTransfer(
      tk,
      { _id: 'operator-id' },
      ['users'],
      {},
      mock<IDataGROWIInfo>(),
    );

    expect(socket.emit).not.toHaveBeenCalledWith(
      'admin:g2gProgress',
      expect.objectContaining({ mongo: G2G_PROGRESS_STATUS.COMPLETED }),
    );
    expect(socket.emit).not.toHaveBeenCalledWith(
      'admin:g2gProgress',
      expect.objectContaining({ rescue: expect.anything() }),
    );
  });
});

describe('G2GTransferPusherService.startTransfer post-process clean-up failure', () => {
  // Requirements 5.3, 5.4, 5.5: a failed clean-up step (upload configs, the
  // destination-owned configs, or session invalidation) leaves the destination
  // silently wrong even though every collection imported. design.md's Error
  // Strategy says these land "ログと通知に落とす" (log and notify) -- the log half
  // already existed; this is the notify half.
  test('reports a failure rather than a completed transfer when a post-process clean-up step failed', async () => {
    const { crowi, socket } = buildCrowiAndSocket();
    const pusher = new G2GTransferPusherService(crowi);

    vi.spyOn(rawAxios, 'post').mockResolvedValueOnce(
      mock<AxiosResponse>({
        data: {
          failedCollections: [],
          importAborted: false,
          postProcessFailures: ['restore-destination-owned-configs'],
        },
      }),
    );
    vi.spyOn(pusher, 'transferAttachments').mockResolvedValueOnce();

    await pusher.startTransfer(
      tk,
      { _id: 'operator-id' },
      ['pages'],
      {},
      mock<IDataGROWIInfo>(),
    );

    expect(socket.emit).not.toHaveBeenCalledWith(
      'admin:g2gProgress',
      expect.objectContaining({ mongo: G2G_PROGRESS_STATUS.COMPLETED }),
    );
    expect(socket.emit).toHaveBeenCalledWith(
      'admin:g2gProgress',
      expect.objectContaining({ mongo: G2G_PROGRESS_STATUS.ERROR }),
    );
  });

  test('stays a success when there are no post-process failures (no false positive)', async () => {
    const { crowi, socket } = buildCrowiAndSocket();
    const pusher = new G2GTransferPusherService(crowi);

    vi.spyOn(rawAxios, 'post').mockResolvedValueOnce(
      mock<AxiosResponse>({
        data: {
          failedCollections: [],
          importAborted: false,
          postProcessFailures: [],
        },
      }),
    );
    vi.spyOn(pusher, 'transferAttachments').mockResolvedValueOnce();

    await pusher.startTransfer(
      tk,
      { _id: 'operator-id' },
      ['pages'],
      {},
      mock<IDataGROWIInfo>(),
    );

    expect(socket.emit).toHaveBeenCalledWith('admin:g2gProgress', {
      mongo: G2G_PROGRESS_STATUS.COMPLETED,
      attachments: G2G_PROGRESS_STATUS.COMPLETED,
    });
  });
});
