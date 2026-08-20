import React, {
  type JSX,
  useCallback,
  useEffect,
  useId,
  useState,
} from 'react';
import { useTranslation } from 'next-i18next';

import { useGenerateTransferKey } from '~/client/services/g2g-transfer';
import { apiv3Get, apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { useAdminSocket } from '~/features/admin/states/socket-io';
import {
  G2G_PROGRESS_STATUS,
  type G2GProgress,
} from '~/interfaces/g2g-transfer';
import {
  buildMergeTransferPlan,
  buildMigrationTransferPlan,
  type TransferPreset,
} from '~/models/admin/g2g-transfer-preset';
import type { TransferPreflightResult } from '~/server/service/g2g-transfer';
import { useGrowiDocumentationUrl } from '~/states/context';

import CustomCopyToClipBoard from '../Common/CustomCopyToClipBoard';
import G2GDataTransferExportForm from './G2GDataTransferExportForm';
import G2GDataTransferStatusIcon from './G2GDataTransferStatusIcon';
import { G2GTransferConfirmModal } from './G2GTransferConfirmModal';
// import { FileUploadSettingMolecule } from './App/FileUploadSetting';
import { buildG2GErrorToastContents } from './g2g-error-toast-contents';

const G2GDataTransfer = (): JSX.Element => {
  const socket = useAdminSocket();
  const { t } = useTranslation(['admin', 'commons']);
  const transferPresetHeadingId = useId();

  const [startTransferKey, setStartTransferKey] = useState('');
  // Requirement 1.1: "migration" (引っ越し) is the initial selection.
  const [transferPreset, setTransferPreset] =
    useState<TransferPreset>('migration');
  const [collections, setCollections] = useState<string[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(
    new Set(),
  );
  const [optionsMap, setOptionsMap] = useState<any>({});
  const [isShowExportForm, setShowExportForm] = useState(false);
  const [isConfirmModalOpen, setConfirmModalOpen] = useState(false);
  // Requirement 3.1: what the pushing server's preflight check reported -- how much of
  // the destination will be deleted, and any warnings. Populated before the confirm
  // modal opens, never guessed at or hardcoded on the client.
  const [preflightResult, setPreflightResult] =
    useState<TransferPreflightResult | null>(null);
  const [isTransferring, setTransferring] = useState(false);
  const [g2gProgress, setG2GProgress] = useState<G2GProgress>({
    mongo: G2G_PROGRESS_STATUS.PENDING,
    attachments: G2G_PROGRESS_STATUS.PENDING,
  });

  // File upload settings
  // const [fileUploadType, setFileUploadType] = useState('aws');
  // const [s3ReferenceFileWithRelayMode, setS3ReferenceFileWithRelayMode] = useState(false);
  // const [s3Region, setS3Region] = useState('');
  // const [s3CustomEndpoint, setS3CustomEndpoint] = useState('');
  // const [s3Bucket, setS3Bucket] = useState('');
  // const [s3AccessKeyId, setS3AccessKeyId] = useState('');
  // const [s3SecretAccessKey, setS3SecretAccessKey] = useState('');
  // const [gcsReferenceFileWithRelayMode, setGcsReferenceFileWithRelayMode] = useState(false);
  // const [gcsApiKeyJsonPath, setGcsApiKeyJsonPath] = useState('');
  // const [gcsBucket, setGcsBucket] = useState('');
  // const [gcsUploadNamespace, setGcsUploadNamespace] = useState('');

  const updateSelectedCollections = useCallback(
    (newSelectedCollections: Set<string>) => {
      setSelectedCollections(newSelectedCollections);
    },
    [],
  );

  const updateOptionsMap = useCallback((newOptionsMap: any) => {
    setOptionsMap(newOptionsMap);
  }, []);

  const onChangeTransferKeyHandler = useCallback((e) => {
    setStartTransferKey(e.target.value);
  }, []);

  const setCollectionsAndSelectedCollections = useCallback(async () => {
    // The server decides which collections a transfer may carry — the screen used to
    // keep its own list, which the transfer endpoints could not rely on and which had
    // already drifted from the collections the transfer actually refuses.
    const { data } = await apiv3Get<{ collections: string[] }>(
      '/g2g-transfer/transferable-collections',
      {},
    );

    setCollections(data.collections);
    setSelectedCollections(new Set(data.collections));
  }, []);

  const setupWebsocketEventHandler = useCallback(() => {
    if (socket != null) {
      socket.on('admin:g2gProgress', (g2gProgress: G2GProgress) => {
        setG2GProgress(g2gProgress);

        if (
          g2gProgress.mongo === G2G_PROGRESS_STATUS.COMPLETED &&
          g2gProgress.attachments === G2G_PROGRESS_STATUS.COMPLETED
        ) {
          toastSuccess(t('admin:g2g.transfer_success'));
        }
      });

      socket.on(
        'admin:g2gError',
        ({ key, message }: { key: string; message: string }) => {
          setTransferring(false);
          toastError(buildG2GErrorToastContents(key, t(key), message));
        },
      );
    }
  }, [socket, t]);

  const cleanUpWebsocketEventHandler = useCallback(() => {
    if (socket != null) {
      socket.off('admin:g2gProgress');
      socket.off('admin:g2gError');
    }
  }, [socket]);

  const { transferKey, generateTransferKey } = useGenerateTransferKey();

  const onClickHandler = useCallback(async () => {
    try {
      await generateTransferKey();
    } catch (errs) {
      toastError(errs);
    }
  }, [generateTransferKey]);

  // Requirements 3.1-3.3: before anything is sent, ask the pushing server what a
  // migration transfer would delete on the destination and whether there is anything
  // to warn about, then show the confirm modal with that report. Neither the archive
  // nor any request to the destination happens until the operator confirms there
  // (`startTransfer`, below) -- a failed preflight leaves the modal unopened and the
  // destination untouched, same as declining to confirm does.
  const askBeforeTransfer = useCallback(
    async (e) => {
      e.preventDefault();
      try {
        const { data } = await apiv3Post<TransferPreflightResult>(
          '/g2g-transfer/preflight',
          { transferKey: startTransferKey },
        );
        setPreflightResult(data);
        setConfirmModalOpen(true);
      } catch (errs) {
        toastError(errs);
      }
    },
    [startTransferKey],
  );

  const startTransfer = useCallback(async () => {
    setConfirmModalOpen(false);
    setTransferring(true);
    // Clears the previous transfer's progress icons and rescue outcome before this
    // one's own progress events start arriving. Without this, a transfer refused by
    // the execution-time re-check (task 10.2) -- which refuses before a single
    // `admin:g2gProgress` event is emitted for this attempt -- leaves the previous
    // transfer's stale rescue list (and stale COMPLETED icons) on screen right next
    // to this attempt's refusal toast.
    setG2GProgress({
      mongo: G2G_PROGRESS_STATUS.PENDING,
      attachments: G2G_PROGRESS_STATUS.PENDING,
    });

    // Requirement 1.2: under "migration", every transferable collection is the
    // target and every one of them is replaced -- the operator never chose a
    // subset or a method, so build the plan from the full collection list rather
    // than from `selectedCollections`/`optionsMap` (which the migration preset
    // never lets the operator populate). Under "merge", send exactly what the
    // operator chose, unchanged (requirement 6.1).
    const transferPlan =
      transferPreset === 'migration'
        ? buildMigrationTransferPlan(collections)
        : buildMergeTransferPlan(Array.from(selectedCollections), optionsMap);

    try {
      await apiv3Post('/g2g-transfer/transfer', {
        transferKey: startTransferKey,
        collections: transferPlan.collections,
        optionsMap: transferPlan.optionsMap,
      });
    } catch (errs) {
      toastError(errs);
    }
  }, [
    startTransferKey,
    transferPreset,
    collections,
    selectedCollections,
    optionsMap,
  ]);

  const documentationUrl = useGrowiDocumentationUrl();

  // File upload
  // const onChangeFileUploadTypeHandler = useCallback((e: ChangeEvent, type: string) => {
  //   setFileUploadType(type);
  // }, []);

  // S3
  // const onChangeS3ReferenceFileWithRelayModeHandler = useCallback((val: boolean) => {
  //   setS3ReferenceFileWithRelayMode(val);
  // }, []);

  // const onChangeS3RegionHandler = useCallback((val: string) => {
  //   setS3Region(val);
  // }, []);

  // const onChangeS3CustomEndpointHandler = useCallback((val: string) => {
  //   setS3CustomEndpoint(val);
  // }, []);

  // const onChangeS3BucketHandler = useCallback((val: string) => {
  //   setS3Bucket(val);
  // }, []);

  // const onChangeS3AccessKeyIdHandler = useCallback((val: string) => {
  //   setS3AccessKeyId(val);
  // }, []);

  // const onChangeS3SecretAccessKeyHandler = useCallback((val: string) => {
  //   setS3SecretAccessKey(val);
  // }, []);

  // // GCS
  // const onChangeGcsReferenceFileWithRelayModeHandler = useCallback((val: boolean) => {
  //   setGcsReferenceFileWithRelayMode(val);
  // }, []);

  // const onChangeGcsApiKeyJsonPathHandler = useCallback((val: string) => {
  //   setGcsApiKeyJsonPath(val);
  // }, []);

  // const onChangeGcsBucketHandler = useCallback((val: string) => {
  //   setGcsBucket(val);
  // }, []);

  // const onChangeGcsUploadNamespaceHandler = useCallback((val: string) => {
  //   setGcsUploadNamespace(val);
  // }, []);

  useEffect(() => {
    setCollectionsAndSelectedCollections();
    setupWebsocketEventHandler();

    return () => {
      cleanUpWebsocketEventHandler();
    };
  }, [
    setCollectionsAndSelectedCollections,
    setupWebsocketEventHandler,
    cleanUpWebsocketEventHandler,
  ]);

  return (
    <div data-testid="admin-export-archive-data">
      <h2 className="border-bottom">
        {t('admin:g2g_data_transfer.transfer_data_to_another_growi')}
      </h2>

      {/*
        Requirements 1.1, 1.2, 1.4: one choice, up front, decides everything else on
        this screen. Under "migration" neither the collection selection nor the
        import-method selection is rendered at all (not merely hidden), so an
        operator cannot build the mixed replace/append assignment the receiving
        side's coherence guard (task 9.1) would refuse.
      */}
      <div className="mb-4">
        <h3 className="mb-2" id={transferPresetHeadingId}>
          {t('admin:g2g_data_transfer.transfer_method.heading')}
        </h3>
        {/*
          The heading above is not itself part of the radio markup (it also isn't a
          `<label>`), so without this the two radios are exposed to assistive tech as
          two unrelated controls with no group name. `role="radiogroup"` +
          `aria-labelledby` names the group from the existing heading without
          changing anything visually (a plain `div`, no new className).
        */}
        <div role="radiogroup" aria-labelledby={transferPresetHeadingId}>
          <div className="form-check">
            <input
              type="radio"
              id="g2gTransferPresetMigration"
              name="g2gTransferPreset"
              className="form-check-input"
              checked={transferPreset === 'migration'}
              disabled={isTransferring}
              onChange={() => setTransferPreset('migration')}
            />
            <label
              className="form-check-label"
              htmlFor="g2gTransferPresetMigration"
            >
              {t('admin:g2g_data_transfer.transfer_method.migration')}
            </label>
          </div>
          <div className="form-check">
            <input
              type="radio"
              id="g2gTransferPresetMerge"
              name="g2gTransferPreset"
              className="form-check-input"
              checked={transferPreset === 'merge'}
              disabled={isTransferring}
              onChange={() => setTransferPreset('merge')}
            />
            <label
              className="form-check-label"
              htmlFor="g2gTransferPresetMerge"
            >
              {t('admin:g2g_data_transfer.transfer_method.merge')}
            </label>
          </div>
        </div>
      </div>

      {transferPreset === 'merge' && (
        <button
          type="button"
          className="btn btn-outline-secondary mt-4"
          disabled={isTransferring}
          onClick={() => setShowExportForm(!isShowExportForm)}
        >
          {t('admin:g2g_data_transfer.advanced_options')}
        </button>
      )}

      {transferPreset === 'merge' && collections.length !== 0 && (
        <div className={`${isShowExportForm ? '' : 'd-none'} px-3 pt-3`}>
          {/* <h3 className='mb-1'>{t('admin:app_setting.file_upload')}</h3>
          <FileUploadSettingMolecule
            fileUploadType={fileUploadType}
            isFixedFileUploadByEnvVar={false}
            onChangeFileUploadType={onChangeFileUploadTypeHandler}
            s3ReferenceFileWithRelayMode={s3ReferenceFileWithRelayMode}
            s3Region={s3Region}
            s3CustomEndpoint={s3CustomEndpoint}
            s3Bucket={s3Bucket}
            s3AccessKeyId={s3AccessKeyId}
            s3SecretAccessKey={s3SecretAccessKey}
            onChangeS3ReferenceFileWithRelayMode={onChangeS3ReferenceFileWithRelayModeHandler}
            onChangeS3Region={onChangeS3RegionHandler}
            onChangeS3CustomEndpoint={onChangeS3CustomEndpointHandler}
            onChangeS3Bucket={onChangeS3BucketHandler}
            onChangeS3AccessKeyId={onChangeS3AccessKeyIdHandler}
            onChangeS3SecretAccessKey={onChangeS3SecretAccessKeyHandler}
            gcsReferenceFileWithRelayMode={gcsReferenceFileWithRelayMode}
            gcsUseOnlyEnvVars={false}
            gcsApiKeyJsonPath={gcsApiKeyJsonPath}
            gcsBucket={gcsBucket}
            gcsUploadNamespace={gcsUploadNamespace}
            onChangeGcsReferenceFileWithRelayMode={onChangeGcsReferenceFileWithRelayModeHandler}
            onChangeGcsApiKeyJsonPath={onChangeGcsApiKeyJsonPathHandler}
            onChangeGcsBucket={onChangeGcsBucketHandler}
            onChangeGcsUploadNamespace={onChangeGcsUploadNamespaceHandler}
          /> */}
          <h3 className="mb-1">{t('export_management.export_archive_data')}</h3>
          <G2GDataTransferExportForm
            allCollectionNames={collections}
            selectedCollections={selectedCollections}
            updateSelectedCollections={updateSelectedCollections}
            optionsMap={optionsMap}
            updateOptionsMap={updateOptionsMap}
          />
        </div>
      )}

      <form onSubmit={askBeforeTransfer}>
        <div className="row mt-3">
          <div className="col-9">
            <input
              className="form-control"
              type="text"
              placeholder={t('admin:g2g_data_transfer.paste_transfer_key')}
              onChange={onChangeTransferKeyHandler}
              required
            />
          </div>
          <div className="col-3">
            <button type="submit" className="btn btn-primary w-100">
              {t('admin:g2g_data_transfer.start_transfer')}
            </button>
          </div>
        </div>
      </form>

      <G2GTransferConfirmModal
        isOpen={isConfirmModalOpen}
        onClose={() => setConfirmModalOpen(false)}
        onConfirm={startTransfer}
        preflightResult={preflightResult}
        transferPreset={transferPreset}
      />

      {/*
        Requirements 4.6, 4.10, 4.8: `isTransferring` alone would hide this panel --
        rescue outcome included -- the instant a later `admin:g2gError` arrives
        (setTransferring(false), below), and a migration whose import partly failed
        emits exactly that error right after the completion progress event
        (server/service/g2g-transfer.ts's `reportIncompleteImport`). That is precisely
        the scenario requirement 4.8 cares about -- the destination left half migrated,
        reachable only through the rescued administrator account -- so the rescued
        username must not disappear from the screen when it happens. Once a rescue
        outcome has arrived, it keeps the whole panel open regardless of `isTransferring`.
      */}
      {(isTransferring || g2gProgress.rescue != null) && (
        <div className="border rounded p-4">
          <div className="my-2">
            <G2GDataTransferStatusIcon
              className="me-2"
              status={g2gProgress.mongo}
            />{' '}
            MongoDB
          </div>
          <div className="my-2">
            <G2GDataTransferStatusIcon
              className="me-2"
              status={g2gProgress.attachments}
            />{' '}
            Attachments
          </div>

          {/*
            What the pusher read out of the destination's response body and put on
            the completion notification (task 10.3) -- omitted entirely when the
            transfer never replaced `users` or rescued nobody, same as
            `g2gProgress.rescue` itself being absent then.
          */}
          {g2gProgress.rescue != null &&
            g2gProgress.rescue.rescued.length > 0 && (
              <div className="alert alert-info mt-3 mb-0" role="status">
                <p className="mb-1">
                  {t('admin:g2g_data_transfer.rescue_outcome.heading')}
                </p>
                <ul className="mb-0">
                  {g2gProgress.rescue.rescued.map((rescued) => (
                    <li key={rescued.originalUsername}>
                      <strong>{rescued.rescuedUsername}</strong>
                      {rescued.originalUsername !== rescued.rescuedUsername && (
                        <span className="text-muted">
                          {` (${t('admin:g2g_data_transfer.rescue_outcome.renamed_from')}: ${rescued.originalUsername})`}
                        </span>
                      )}
                      {(rescued.emailRemoved ||
                        rescued.slackMemberIdRemoved ||
                        rescued.idReassigned) && (
                        <ul className="mb-0">
                          {rescued.emailRemoved && (
                            <li>
                              {t(
                                'admin:g2g_data_transfer.rescue_outcome.email_removed',
                              )}
                            </li>
                          )}
                          {rescued.slackMemberIdRemoved && (
                            <li>
                              {t(
                                'admin:g2g_data_transfer.rescue_outcome.slack_member_id_removed',
                              )}
                            </li>
                          )}
                          {rescued.idReassigned && (
                            <li>
                              {t(
                                'admin:g2g_data_transfer.rescue_outcome.id_reassigned',
                              )}
                            </li>
                          )}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
        </div>
      )}

      <h2 className="border-bottom mt-5">
        {t('commons:g2g_data_transfer.transfer_data_to_this_growi')}
      </h2>

      <div className="row mt-4">
        <div className="col-md-3">
          <button
            type="button"
            className="btn btn-primary w-100"
            onClick={onClickHandler}
          >
            {t('commons:g2g_data_transfer.publish_transfer_key')}
          </button>
        </div>
        <div className="col-md-9">
          <div className=" mx-1">
            <input
              className="form-control"
              type="text"
              value={transferKey}
              readOnly
            />
            <CustomCopyToClipBoard
              textToBeCopied={transferKey}
              message="admin:slack_integration.copied_to_clipboard"
            />
          </div>
        </div>
      </div>

      <div className="alert alert-warning mt-4">
        <p className="mb-1">
          {t('commons:g2g_data_transfer.transfer_key_limit')}
        </p>
        <p className="mb-1">
          {t('commons:g2g_data_transfer.once_transfer_key_used')}
        </p>
        <p
          className="mb-0"
          // biome-ignore lint/security/noDangerouslySetInnerHtml: translation contains HTML link
          dangerouslySetInnerHTML={{
            __html: t('commons:g2g_data_transfer.transfer_to_growi_cloud', {
              documentationUrl,
            }),
          }}
        />
      </div>
    </div>
  );
};

export default G2GDataTransfer;
