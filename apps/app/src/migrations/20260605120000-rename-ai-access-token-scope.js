import loggerFactory from '~/utils/logger';

const logger = loggerFactory('growi:migrate:rename-ai-access-token-scope');

// Access tokens persist their granted scope strings. The AI-related scopes were
// renamed/removed in @growi/core:
//   - features:ai_assistant -> features:ai  (read/write): renamed
//   - admin:ai_integration   (read/write): removed (admin AI integration screen gone)
// This migration remaps the persisted scopes on existing tokens so they keep
// matching the new scope contract. Idempotent: re-running touches nothing once
// no token carries the old scope strings.
const COLLECTION = 'accesstokens';
const REMOVED_SCOPES = [
  'read:admin:ai_integration',
  'write:admin:ai_integration',
];

export async function up(db) {
  logger.info(
    'Apply migration: rename features:ai_assistant -> features:ai and drop admin:ai_integration scopes',
  );

  const oldScopes = [
    'read:features:ai_assistant',
    'write:features:ai_assistant',
    ...REMOVED_SCOPES,
  ];

  const result = await db
    .collection(COLLECTION)
    .updateMany({ scopes: { $in: oldScopes } }, [
      {
        $set: {
          scopes: {
            $map: {
              input: '$scopes',
              as: 's',
              in: {
                $cond: [
                  { $eq: ['$$s', 'read:features:ai_assistant'] },
                  'read:features:ai',
                  {
                    $cond: [
                      { $eq: ['$$s', 'write:features:ai_assistant'] },
                      'write:features:ai',
                      '$$s',
                    ],
                  },
                ],
              },
            },
          },
        },
      },
      {
        $set: {
          scopes: {
            $filter: {
              input: '$scopes',
              as: 's',
              cond: { $not: { $in: ['$$s', REMOVED_SCOPES] } },
            },
          },
        },
      },
    ]);

  logger.info(`Remapped scopes on ${result.modifiedCount} access token(s).`);
}

export async function down(db) {
  // Best-effort rollback: revert the feature-scope rename only.
  // The removed admin:ai_integration scopes cannot be restored because which
  // tokens originally held them is no longer known.
  logger.info(
    'Rollback migration: revert features:ai -> features:ai_assistant',
  );

  const result = await db
    .collection(COLLECTION)
    .updateMany(
      { scopes: { $in: ['read:features:ai', 'write:features:ai'] } },
      [
        {
          $set: {
            scopes: {
              $map: {
                input: '$scopes',
                as: 's',
                in: {
                  $cond: [
                    { $eq: ['$$s', 'read:features:ai'] },
                    'read:features:ai_assistant',
                    {
                      $cond: [
                        { $eq: ['$$s', 'write:features:ai'] },
                        'write:features:ai_assistant',
                        '$$s',
                      ],
                    },
                  ],
                },
              },
            },
          },
        },
      ],
    );

  logger.info(`Reverted scopes on ${result.modifiedCount} access token(s).`);
}
