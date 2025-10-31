import React, {
  useCallback, useEffect, useState, type JSX,
} from 'react';

import { useTranslation } from 'next-i18next';

import { useGenerateTransferKey } from '~/client/services/g2g-transfer';
import { apiv3Get, apiv3Post } from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { useAdminSocket } from '~/features/admin/states/socket-io';
import { G2G_PROGRESS_STATUS, type G2GProgress } from '~/interfaces/g2g-transfer';
import { useGrowiDocumentationUrl } from '~/states/context';

import CustomCopyToClipBoard from '../Common/CustomCopyToClipBoard';

// import { FileUploadSettingMolecule } from './App/FileUploadSetting';
import G2GDataTransferExportForm from './G2GDataTransferExportForm';
import G2GDataTransferStatusIcon from './G2GDataTransferStatusIcon';

const IGNORED_COLLECTION_NAMES = [
  'sessions', 'rlflx', 'activities', 'attachmentFiles.files', 'attachmentFiles.chunks',
];

const G2GDataTransfer = (): JSX.Element => {
  const socket = useAdminSocket();
  const { t } = useTranslation(['admin', 'commons']);

  const [startTransferKey, setStartTransferKey] = useState('');
  const [collections, setCollections] = useState<string[]>([]);
  const [selectedCollections, setSelectedCollections] = useState<Set<string>>(new Set());
  const [optionsMap, setOptionsMap] = useState<any>({});
  const [isShowExportForm, setShowExportForm] = useState(false);
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

  const updateSelectedCollections = (newSelectedCollections: Set<string>) => {
    setSelectedCollections(newSelectedCollections);
  };

  const updateOptionsMap = (newOptionsMap: any) => {
    setOptionsMap(newOptionsMap);
  };

  const onChangeTransferKeyHandler = useCallback((e) => {
    setStartTransferKey(e.target.value);
  }, []);

  const setCollectionsAndSelectedCollections = useCallback(async() => {
    const { data: collectionsData } = await apiv3Get<{collections: any[]}>('/mongo/collections', {});

    // filter only not ignored collection names
    const filteredCollections = collectionsData.collections.filter((collectionName) => {
      return !IGNORED_COLLECTION_NAMES.includes(collectionName);
    });

    setCollections(filteredCollections);
    setSelectedCollections(new Set(filteredCollections));
  }, []);

  const setupWebsocketEventHandler = useCallback(() => {
    if (socket != null) {
      socket.on('admin:g2gProgress', (g2gProgress: G2GProgress) => {
        setG2GProgress(g2gProgress);

        if (g2gProgress.mongo === G2G_PROGRESS_STATUS.COMPLETED && g2gProgress.attachments === G2G_PROGRESS_STATUS.COMPLETED) {
          toastSuccess(t('admin:g2g:transfer_success'));
        }
      });

      socket.on('admin:g2gError', ({ key }) => {
        setTransferring(false);
        toastError(t(key));
      });
    }
  }, [socket, t, setTransferring, setG2GProgress]);

  const cleanUpWebsocketEventHandler = useCallback(() => {
    if (socket != null) {
      socket.off('admin:g2gProgress');
      socket.off('admin:g2gError');
    }
  }, [socket]);

  const { transferKey, generateTransferKey } = useGenerateTransferKey();

  const onClickHandler = useCallback(async() => {
    try {
      await generateTransferKey();
    }
    catch (errs) {
      toastError(errs);
    }
  }, [generateTransferKey]);

  const startTransfer = useCallback(async(e) => {
    e.preventDefault();
    setTransferring(true);

    try {
      await apiv3Post('/g2g-transfer/transfer', {
        transferKey: startTransferKey,
        collections: Array.from(selectedCollections),
        optionsMap,
      });
    }
    catch (errs) {
      toastError(errs);
    }
  }, [setTransferring, startTransferKey, selectedCollections, optionsMap]);

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
  }, [setCollectionsAndSelectedCollections, setupWebsocketEventHandler, cleanUpWebsocketEventHandler]);

  return (
    <div data-testid="admin-export-archive-data">
      <h2 className="border-bottom">{t('admin:g2g_data_transfer.transfer_data_to_another_growi')}</h2>

      <button type="button" className="btn btn-outline-secondary mt-4" disabled={isTransferring} onClick={() => setShowExportForm(!isShowExportForm)}>
        {t('admin:g2g_data_transfer.advanced_options')}
      </button>

      {collections.length !== 0 && (
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

      <form onSubmit={startTransfer}>
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
            <button type="submit" className="btn btn-primary w-100">{t('admin:g2g_data_transfer.start_transfer')}</button>
          </div>
        </div>
      </form>

      {isTransferring && (
        <div className="border rounded p-4">
          <div className="my-2">
            <G2GDataTransferStatusIcon className="me-2" status={g2gProgress.mongo} /> MongoDB
          </div>
          <div className="my-2">
            <G2GDataTransferStatusIcon className="me-2" status={g2gProgress.attachments} /> Attachments
          </div>
        </div>
      )}

      <h2 className="border-bottom mt-5">{t('commons:g2g_data_transfer.transfer_data_to_this_growi')}</h2>

      <div className="row mt-4">
        <div className="col-md-3">
          <button type="button" className="btn btn-primary w-100" onClick={onClickHandler}>
            {t('commons:g2g_data_transfer.publish_transfer_key')}
          </button>
        </div>
        <div className="col-md-9">
          <div className=" mx-1">
            <input className="form-control" type="text" value={transferKey} readOnly />
            <CustomCopyToClipBoard textToBeCopied={transferKey} message="admin:slack_integration.copied_to_clipboard" />
          </div>
        </div>
      </div>

      <div className="alert alert-warning mt-4">
        <p className="mb-1">{t('commons:g2g_data_transfer.transfer_key_limit')}</p>
        <p className="mb-1">{t('commons:g2g_data_transfer.once_transfer_key_used')}</p>
        <p
          className="mb-0"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{
            __html: t('commons:g2g_data_transfer.transfer_to_growi_cloud', { documentationUrl }),
          }}
        />
      </div>
    </div>
  );
};

export default G2GDataTransfer;
