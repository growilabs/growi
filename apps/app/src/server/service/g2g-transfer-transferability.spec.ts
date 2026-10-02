import {
  describeBlocker,
  evaluateBlockers,
  evaluateTransferability,
  type TransferabilityDestination,
  type TransferabilitySource,
  type TransferBlocker,
} from './g2g-transfer-transferability';

/*
 * Plain data fixtures (not collaborators), so every field is spelled out via a
 * default that represents "nothing to report" — a compatible, unremarkable transfer —
 * and each test only overrides the field(s) its condition actually depends on.
 */
const buildSource = (
  overrides: Partial<TransferabilitySource> = {},
): TransferabilitySource => ({
  version: '7.5.0',
  activeUsers: 10,
  totalFileSize: 1_000,
  fileUploadType: 'aws',
  passwordSeedFingerprint: 'fingerprint-a',
  isLocalAuthEnabled: true,
  ...overrides,
});

const buildDest = (
  overrides: Partial<TransferabilityDestination> = {},
): TransferabilityDestination => ({
  version: '7.5.0',
  userUpperLimit: null,
  fileUploadTotalLimit: null,
  attachmentInfo: { type: 'aws', writable: true },
  passwordSeedFingerprint: 'fingerprint-a',
  loginableAdminCount: 1,
  sessionStoreSupportsEnumeration: true,
  ...overrides,
});

describe('evaluateTransferability', () => {
  test('reports neither a blocker nor a warning for a compatible transfer', () => {
    const report = evaluateTransferability(buildSource(), buildDest());

    expect(report).toEqual({ blockers: [], warnings: [] });
  });

  describe('blockers (existing compatibility checks, relocated -- must not change)', () => {
    test('blocks on a GROWI version mismatch', () => {
      const report = evaluateTransferability(
        buildSource({ version: '7.5.0' }),
        buildDest({ version: '7.4.0' }),
      );

      expect(report.blockers).toEqual([
        { type: 'version_mismatch', src: '7.5.0', dest: '7.4.0' },
      ]);
    });

    test('blocks when active users at the source exceed the destination upper limit', () => {
      const report = evaluateTransferability(
        buildSource({ activeUsers: 11 }),
        buildDest({ userUpperLimit: 10 }),
      );

      expect(report.blockers).toEqual([
        { type: 'user_upper_limit', activeUsers: 11, limit: 10 },
      ]);
    });

    test('does not block on the user limit when the destination has none (null == unlimited)', () => {
      const report = evaluateTransferability(
        buildSource({ activeUsers: 1_000_000 }),
        buildDest({ userUpperLimit: null }),
      );

      expect(report.blockers).toEqual([]);
    });

    test('does not block when active users exactly equal the destination upper limit (limit means "up to", not "fewer than")', () => {
      const report = evaluateTransferability(
        buildSource({ activeUsers: 10 }),
        buildDest({ userUpperLimit: 10 }),
      );

      expect(report.blockers).toEqual([]);
    });

    test('blocks when file upload is not configured at the destination', () => {
      // `writable: true` keeps this isolated to the one condition under test: a real
      // "type: none" destination would likely be unwritable too, and that combination
      // is covered separately below (both blockers may legitimately apply at once).
      const report = evaluateTransferability(
        buildSource(),
        buildDest({ attachmentInfo: { type: 'none', writable: true } }),
      );

      expect(report.blockers).toEqual([
        { type: 'file_upload_not_configured', side: 'dest' },
      ]);
    });

    test('blocks when file upload is not configured at the source', () => {
      const report = evaluateTransferability(
        buildSource({ fileUploadType: 'none' }),
        buildDest(),
      );

      expect(report.blockers).toEqual([
        { type: 'file_upload_not_configured', side: 'src' },
      ]);
    });

    test('blocks when the destination storage is not writable', () => {
      const report = evaluateTransferability(
        buildSource(),
        buildDest({ attachmentInfo: { type: 'aws', writable: false } }),
      );

      expect(report.blockers).toEqual([
        { type: 'destination_storage_not_writable' },
      ]);
    });

    test('blocks when the required storage exceeds the destination file upload limit', () => {
      const report = evaluateTransferability(
        buildSource({ totalFileSize: 2_000 }),
        buildDest({ fileUploadTotalLimit: 1_000 }),
      );

      expect(report.blockers).toEqual([
        { type: 'file_upload_total_limit', required: 2_000, limit: 1_000 },
      ]);
    });

    test('does not block on the total file size when the destination has no limit (null == unlimited)', () => {
      const report = evaluateTransferability(
        buildSource({ totalFileSize: 1_000_000_000 }),
        buildDest({ fileUploadTotalLimit: null }),
      );

      expect(report.blockers).toEqual([]);
    });

    test('does not block when the required storage exactly equals the destination file upload limit (limit means "up to", not "fewer than")', () => {
      const report = evaluateTransferability(
        buildSource({ totalFileSize: 1_000 }),
        buildDest({ fileUploadTotalLimit: 1_000 }),
      );

      expect(report.blockers).toEqual([]);
    });

    test('reports every applicable blocker, in the same priority order the original checks ran', () => {
      // The original code was a sequence of early returns, so a caller that reads only
      // the first reason (as `G2GTransferPusherService.getTransferability` does) always
      // saw the version mismatch reported first, never the user-limit breach beneath
      // it. `blockers[0]` has to keep landing on the same one.
      const report = evaluateTransferability(
        buildSource({ version: '7.5.0', activeUsers: 999 }),
        buildDest({ version: '7.4.0', userUpperLimit: 1 }),
      );

      expect(report.blockers).toHaveLength(2);
      expect(report.blockers[0]).toEqual({
        type: 'version_mismatch',
        src: '7.5.0',
        dest: '7.4.0',
      });
    });

    test('when both sides have file upload unconfigured, the destination check is reported first', () => {
      // The original code checked `destGROWIInfo.fileUploadDisabled` (equivalent to
      // `attachmentInfo.type === 'none'`, see describeBlocker's doc comment) before
      // `configManager.getConfig('app:fileUploadType') === 'none'`, so when both sides
      // are unconfigured the caller that reads only `blockers[0]`
      // (`G2GTransferPusherService.getTransferability`) always saw the destination's
      // message, never the source's. That priority has to survive the move.
      const report = evaluateTransferability(
        buildSource({ fileUploadType: 'none' }),
        buildDest({ attachmentInfo: { type: 'none', writable: true } }),
      );

      expect(report.blockers).toEqual([
        { type: 'file_upload_not_configured', side: 'dest' },
        { type: 'file_upload_not_configured', side: 'src' },
      ]);
    });
  });

  describe('warnings', () => {
    test('warns on a password seed fingerprint mismatch', () => {
      const report = evaluateTransferability(
        buildSource({ passwordSeedFingerprint: 'fingerprint-a' }),
        buildDest({ passwordSeedFingerprint: 'fingerprint-b' }),
      );

      expect(report.warnings).toContainEqual({
        type: 'password_seed_mismatch',
      });
    });

    test('does not warn when the password seed fingerprints match', () => {
      const report = evaluateTransferability(
        buildSource({ passwordSeedFingerprint: 'same-fingerprint' }),
        buildDest({ passwordSeedFingerprint: 'same-fingerprint' }),
      );

      expect(report.warnings).not.toContainEqual({
        type: 'password_seed_mismatch',
      });
    });

    test('the password-seed-mismatch warning never carries either fingerprint value', () => {
      // Requirement 3.6: only the match/no-match fact may leave this module, never the
      // fingerprints being compared (and never the seed they were derived from, which
      // this module is never even handed).
      const report = evaluateTransferability(
        buildSource({ passwordSeedFingerprint: 'source-secret-fingerprint' }),
        buildDest({ passwordSeedFingerprint: 'dest-secret-fingerprint' }),
      );

      const mismatch = report.warnings.find(
        (warning) => warning.type === 'password_seed_mismatch',
      );
      expect(mismatch).toEqual({ type: 'password_seed_mismatch' });
      expect(JSON.stringify(report)).not.toContain('source-secret-fingerprint');
      expect(JSON.stringify(report)).not.toContain('dest-secret-fingerprint');
    });

    test('warns when the destination has no administrator who can currently log in', () => {
      const report = evaluateTransferability(
        buildSource(),
        buildDest({ loginableAdminCount: 0 }),
      );

      expect(report.warnings).toContainEqual({ type: 'no_loginable_admin' });
    });

    test('does not warn when the destination has exactly one loginable administrator (no false positive from counting alone)', () => {
      const report = evaluateTransferability(
        buildSource(),
        buildDest({ loginableAdminCount: 1 }),
      );

      expect(report.warnings).not.toContainEqual({
        type: 'no_loginable_admin',
      });
    });

    test('does not warn when the destination has several loginable administrators', () => {
      const report = evaluateTransferability(
        buildSource(),
        buildDest({ loginableAdminCount: 5 }),
      );

      expect(report.warnings).not.toContainEqual({
        type: 'no_loginable_admin',
      });
    });

    test('warns when the destination session store cannot enumerate sessions', () => {
      const report = evaluateTransferability(
        buildSource(),
        buildDest({ sessionStoreSupportsEnumeration: false }),
      );

      expect(report.warnings).toContainEqual({
        type: 'sessions_not_invalidatable',
      });
    });

    test('does not warn when the destination session store can enumerate sessions', () => {
      const report = evaluateTransferability(
        buildSource(),
        buildDest({ sessionStoreSupportsEnumeration: true }),
      );

      expect(report.warnings).not.toContainEqual({
        type: 'sessions_not_invalidatable',
      });
    });

    test('warns when the source has local authentication disabled', () => {
      const report = evaluateTransferability(
        buildSource({ isLocalAuthEnabled: false }),
        buildDest(),
      );

      expect(report.warnings).toContainEqual({
        type: 'local_auth_disabled_at_source',
      });
    });

    test('does not warn when the source has local authentication enabled', () => {
      const report = evaluateTransferability(
        buildSource({ isLocalAuthEnabled: true }),
        buildDest(),
      );

      expect(report.warnings).not.toContainEqual({
        type: 'local_auth_disabled_at_source',
      });
    });

    test('reports every applicable warning at once, not just the first', () => {
      const report = evaluateTransferability(
        buildSource({
          passwordSeedFingerprint: 'a',
          isLocalAuthEnabled: false,
        }),
        buildDest({
          passwordSeedFingerprint: 'b',
          loginableAdminCount: 0,
          sessionStoreSupportsEnumeration: false,
        }),
      );

      expect(report.warnings).toEqual([
        { type: 'password_seed_mismatch' },
        { type: 'no_loginable_admin' },
        { type: 'sessions_not_invalidatable' },
        { type: 'local_auth_disabled_at_source' },
      ]);
    });
  });

  test('a blocking condition does not suppress a warning computed alongside it', () => {
    // Blockers and warnings are independent facts about the same transfer; a caller
    // that shows both (the preflight screen) must see the warning even though this
    // transfer would also be blocked.
    const report = evaluateTransferability(
      buildSource({ version: '7.5.0', isLocalAuthEnabled: false }),
      buildDest({ version: '7.4.0' }),
    );

    expect(report.blockers).toEqual([
      { type: 'version_mismatch', src: '7.5.0', dest: '7.4.0' },
    ]);
    expect(report.warnings).toEqual([
      { type: 'local_auth_disabled_at_source' },
    ]);
  });

  test('agrees with evaluateBlockers on the blocker list, for every case above', () => {
    // `G2GTransferPusherService.getTransferability` calls `evaluateBlockers` directly
    // (it has no warning inputs to offer), while `evaluateTransferability` computes the
    // same blockers internally on the way to a full report. The two must never drift:
    // this pins `evaluateTransferability(...).blockers` to being nothing more than
    // `evaluateBlockers(...)`, run against every fixture combination exercised above.
    const cases: readonly [
      TransferabilitySource,
      TransferabilityDestination,
    ][] = [
      [buildSource(), buildDest()],
      [buildSource({ version: '7.5.0' }), buildDest({ version: '7.4.0' })],
      [buildSource({ activeUsers: 11 }), buildDest({ userUpperLimit: 10 })],
      [
        buildSource(),
        buildDest({ attachmentInfo: { type: 'none', writable: true } }),
      ],
      [buildSource({ fileUploadType: 'none' }), buildDest()],
      [
        buildSource(),
        buildDest({ attachmentInfo: { type: 'aws', writable: false } }),
      ],
      [
        buildSource({ totalFileSize: 2_000 }),
        buildDest({ fileUploadTotalLimit: 1_000 }),
      ],
      [
        buildSource({ fileUploadType: 'none' }),
        buildDest({ attachmentInfo: { type: 'none', writable: true } }),
      ],
      [
        buildSource({ version: '7.5.0', activeUsers: 999 }),
        buildDest({ version: '7.4.0', userUpperLimit: 1 }),
      ],
    ];

    for (const [src, dest] of cases) {
      expect(evaluateTransferability(src, dest).blockers).toEqual(
        evaluateBlockers(src, dest),
      );
    }
  });
});

describe('describeBlocker', () => {
  test.each<[TransferBlocker, string]>([
    [
      { type: 'version_mismatch', src: '7.5.0', dest: '7.4.0' },
      'GROWI versions mismatch. src GROWI: 7.5.0 / dest GROWI: 7.4.0.',
    ],
    [
      { type: 'user_upper_limit', activeUsers: 11, limit: 10 },
      'The number of active users (11 users) exceeds the limit of the destination GROWI (up to 10 users).',
    ],
    [
      { type: 'file_upload_not_configured', side: 'dest' },
      'The file upload setting is disabled in the destination GROWI.',
    ],
    [
      { type: 'file_upload_not_configured', side: 'src' },
      'File upload is not configured for src GROWI.',
    ],
    [
      { type: 'destination_storage_not_writable' },
      'The storage of the destination GROWI is not writable.',
    ],
    [
      { type: 'file_upload_total_limit', required: 2_000, limit: 1_000 },
      'The total file size of attachments exceeds the file upload limit of the destination GROWI. Requires 2,000 bytes, but got 1,000 bytes.',
    ],
  ])('describes %o as the historical message', (blocker, expected) => {
    // Byte-identical to what `G2GTransferPusherService.getTransferability` used to
    // build inline, for every condition that could actually fire (see this function's
    // doc comment for the one that never could).
    expect(describeBlocker(blocker)).toBe(expected);
  });
});
