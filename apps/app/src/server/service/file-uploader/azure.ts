import type { TokenCredential } from '@azure/identity';
import { ClientSecretCredential } from '@azure/identity';
import type {
  BlobClient,
  BlobDeleteOptions,
  BlockBlobClient,
  ContainerClient,
} from '@azure/storage-blob';
import {
  type BlobDeleteIfExistsResponse,
  BlobServiceClient,
  type BlockBlobParallelUploadOptions,
  type BlockBlobUploadResponse,
  ContainerSASPermissions,
  generateBlobSASQueryParameters,
  SASProtocol,
} from '@azure/storage-blob';
import { toNonBlankStringOrUndefined } from '@growi/core/dist/interfaces';
import type { Readable } from 'stream';

import type Crowi from '~/server/crowi';
import {
  FilePathOnStoragePrefix,
  type RespondOptions,
  ResponseMode,
} from '~/server/interfaces/attachment';
import type { IAttachmentDocument } from '~/server/models/attachment';
import loggerFactory from '~/utils/logger';

import { configManager } from '../config-manager';
import {
  AbstractFileUploader,
  type SaveFileParam,
  type TemporaryUrl,
} from './file-uploader';
import { createContentHeaders, getContentHeaderValue } from './utils';

const urljoin = require('url-join');

const logger = loggerFactory('growi:service:fileUploaderAzure');

interface FileMeta {
  name: string;
  size: number;
}

type AzureConfig = {
  accountName: string;
  containerName: string;
};

// Cache holders to avoid repeated instantiation of credential and clients
let cachedCredential: { key: string; credential: TokenCredential } | null =
  null;
let cachedBlobServiceClient: { key: string; client: BlobServiceClient } | null =
  null;
let cachedContainerClient: { key: string; client: ContainerClient } | null =
  null;

function getAzureConfig(): AzureConfig {
  const accountName = configManager.getConfig('azure:storageAccountName');
  const containerName = configManager.getConfig('azure:storageContainerName');

  if (accountName == null || containerName == null) {
    throw new Error('Azure Blob Storage is not configured.');
  }

  return {
    accountName,
    containerName,
  };
}

function getCredential(): TokenCredential {
  // Build cache key from credential-related configs
  const tenantId = toNonBlankStringOrUndefined(
    configManager.getConfig('azure:tenantId'),
  );
  const clientId = toNonBlankStringOrUndefined(
    configManager.getConfig('azure:clientId'),
  );
  const clientSecret = toNonBlankStringOrUndefined(
    configManager.getConfig('azure:clientSecret'),
  );

  if (tenantId == null || clientId == null || clientSecret == null) {
    throw new Error(
      `Azure Blob Storage missing required configuration: tenantId=${tenantId}, clientId=${clientId}, clientSecret=${clientSecret}`,
    );
  }

  const key = `${tenantId}|${clientId}|${clientSecret}`;

  // Reuse cached credential when config has not changed
  if (cachedCredential != null && cachedCredential.key === key) {
    return cachedCredential.credential;
  }

  const credential = new ClientSecretCredential(
    tenantId,
    clientId,
    clientSecret,
  );
  cachedCredential = { key, credential };
  return credential;
}

function getBlobServiceClient(): BlobServiceClient {
  const { accountName } = getAzureConfig();
  // Include credential cache key to ensure we re-create if cred changed
  const credential = getCredential();
  const credentialKey = cachedCredential?.key ?? 'unknown-cred';
  const key = `${accountName}|${credentialKey}`;

  if (cachedBlobServiceClient != null && cachedBlobServiceClient.key === key) {
    return cachedBlobServiceClient.client;
  }

  // Use keep-alive to minimize socket churn; reuse client across calls
  const client = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    credential,
    { keepAliveOptions: { enable: true } },
  );
  cachedBlobServiceClient = { key, client };
  return client;
}

async function getContainerClient(): Promise<ContainerClient> {
  const { accountName, containerName } = getAzureConfig();
  const credentialKey = cachedCredential?.key ?? 'unknown-cred';
  const key = `${accountName}|${containerName}|${credentialKey}`;

  if (cachedContainerClient != null && cachedContainerClient.key === key) {
    return cachedContainerClient.client;
  }

  const blobServiceClient = getBlobServiceClient();
  const client = blobServiceClient.getContainerClient(containerName);
  cachedContainerClient = { key, client };
  return client;
}

function getFilePathOnStorage(attachment: IAttachmentDocument) {
  const dirName =
    attachment.page != null
      ? FilePathOnStoragePrefix.attachment
      : FilePathOnStoragePrefix.user;
  return urljoin(dirName, attachment.fileName);
}

class AzureFileUploader extends AbstractFileUploader {
  /**
   * @inheritdoc
   */
  override isValidUploadSettings(): boolean {
    try {
      getAzureConfig();
      return true;
    } catch (e) {
      logger.error(e);
      return false;
    }
  }

  /**
   * @inheritdoc
   */
  override listFiles() {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override saveFile(param: SaveFileParam) {
    throw new Error('Method not implemented.');
  }

  /**
   * @inheritdoc
   */
  override async deleteFile(attachment: IAttachmentDocument): Promise<void> {
    const filePath = getFilePathOnStorage(attachment);
    const containerClient = await getContainerClient();
    const blockBlobClient = await containerClient.getBlockBlobClient(filePath);
    const options: BlobDeleteOptions = { deleteSnapshots: 'include' };
    const blobDeleteIfExistsResponse: BlobDeleteIfExistsResponse =
      await blockBlobClient.deleteIfExists(options);
    if (!blobDeleteIfExistsResponse.errorCode) {
      logger.info(`deleted blob ${filePath}`);
    }
  }

  /**
   * @inheritdoc
   */
  override async deleteFiles(
    attachments: IAttachmentDocument[],
  ): Promise<void> {
    if (!this.getIsUploadable()) {
      throw new Error('Azure is not configured.');
    }
    for await (const attachment of attachments) {
      await this.deleteFile(attachment);
    }
  }

  /**
   * @inheritdoc
   */
  override async uploadAttachment(
    readable: Readable,
    attachment: IAttachmentDocument,
  ): Promise<void> {
    if (!this.getIsUploadable()) {
      throw new Error('Azure is not configured.');
    }

    logger.debug(`File uploading: fileName=${attachment.fileName}`);
    const filePath = getFilePathOnStorage(attachment);
    const containerClient = await getContainerClient();
    const blockBlobClient: BlockBlobClient =
      containerClient.getBlockBlobClient(filePath);
    const contentHeaders = createContentHeaders(attachment);

    try {
      const uploadTimeout = configManager.getConfig('app:fileUploadTimeout');

      await blockBlobClient.uploadStream(readable, undefined, undefined, {
        blobHTTPHeaders: {
          // put type and the file name for reference information when uploading
          blobContentType: getContentHeaderValue(
            contentHeaders,
            'Content-Type',
          ),
          blobContentDisposition: getContentHeaderValue(
            contentHeaders,
            'Content-Disposition',
          ),
        },
        abortSignal: AbortSignal.timeout(uploadTimeout),
      });

      logger.debug(
        `File upload completed successfully: fileName=${attachment.fileName}`,
      );
    } catch (error) {
      // Handle timeout error specifically
      if (error.name === 'AbortError') {
        logger.warn(`Upload timeout: fileName=${attachment.fileName}`, error);
      } else {
        logger.error(
          `File upload failed: fileName=${attachment.fileName}`,
          error,
        );
      }
      // Re-throw the error to be handled by the caller.
      // The pipeline automatically handles stream cleanup on error.
      throw error;
    }
  }

  /**
   * @inheritdoc
   */
  override determineResponseMode() {
    return configManager.getConfig('azure:referenceFileWithRelayMode')
      ? ResponseMode.RELAY
      : ResponseMode.REDIRECT;
  }

  /**
   * @inheritdoc
   */
  override respond(): void {
    throw new Error(
      'AzureFileUploader does not support ResponseMode.DELEGATE.',
    );
  }

  /**
   * @inheritdoc
   */
  override async findDeliveryFile(
    attachment: IAttachmentDocument,
  ): Promise<NodeJS.ReadableStream> {
    if (!this.getIsReadable()) {
      throw new Error('Azure is not configured.');
    }

    const filePath = getFilePathOnStorage(attachment);
    const containerClient = await getContainerClient();
    const blobClient: BlobClient = containerClient.getBlobClient(filePath);
    const downloadResponse = await blobClient.download();
    if (downloadResponse.errorCode) {
      logger.error(downloadResponse.errorCode);
      throw new Error(downloadResponse.errorCode);
    }
    if (!downloadResponse?.readableStreamBody) {
      throw new Error(
        `Coudn't get file from Azure for the Attachment (${filePath})`,
      );
    }

    return downloadResponse.readableStreamBody;
  }

  /**
   * @inheritDoc
   * @see https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-create-user-delegation-sas-javascript
   */
  override async generateTemporaryUrl(
    attachment: IAttachmentDocument,
    opts?: RespondOptions,
  ): Promise<TemporaryUrl> {
    if (!this.getIsUploadable()) {
      throw new Error('Azure Blob is not configured.');
    }

    const lifetimeSecForTemporaryUrl = configManager.getConfig(
      'azure:lifetimeSecForTemporaryUrl',
    );

    const url = await (async () => {
      const containerClient = await getContainerClient();
      const filePath = getFilePathOnStorage(attachment);
      const blockBlobClient =
        await containerClient.getBlockBlobClient(filePath);
      return blockBlobClient.url;
    })();

    const sasToken = await (async () => {
      const { accountName, containerName } = getAzureConfig();
      // Reuse the same BlobServiceClient (singleton)
      const blobServiceClient = getBlobServiceClient();

      const now = Date.now();
      const startsOn = new Date(now - 30 * 1000);
      const expiresOn = new Date(now + lifetimeSecForTemporaryUrl * 1000);
      const userDelegationKey = await blobServiceClient.getUserDelegationKey(
        startsOn,
        expiresOn,
      );

      const isDownload = opts?.download ?? false;
      const contentHeaders = createContentHeaders(attachment, {
        inline: !isDownload,
      });

      // https://github.com/Azure/azure-sdk-for-js/blob/d4d55f73/sdk/storage/storage-blob/src/ContainerSASPermissions.ts#L24
      // r:read, a:add, c:create, w:write, d:delete, l:list
      const containerPermissionsForAnonymousUser = 'rl';
      const sasOptions = {
        containerName,
        permissions: ContainerSASPermissions.parse(
          containerPermissionsForAnonymousUser,
        ),
        protocol: SASProtocol.HttpsAndHttp,
        startsOn,
        expiresOn,
        contentType: getContentHeaderValue(contentHeaders, 'Content-Type'),
        contentDisposition: getContentHeaderValue(
          contentHeaders,
          'Content-Disposition',
        ),
      };

      return generateBlobSASQueryParameters(
        sasOptions,
        userDelegationKey,
        accountName,
      ).toString();
    })();

    const signedUrl = `${url}?${sasToken}`;

    return {
      url: signedUrl,
      lifetimeSec: lifetimeSecForTemporaryUrl,
    };
  }
}

module.exports = (crowi: Crowi) => {
  const lib = new AzureFileUploader(crowi);

  lib.isValidUploadSettings = () =>
    configManager.getConfig('azure:storageAccountName') != null &&
    configManager.getConfig('azure:storageContainerName') != null;

  lib.saveFile = async ({ filePath, contentType, data }) => {
    const containerClient = await getContainerClient();
    const blockBlobClient: BlockBlobClient =
      containerClient.getBlockBlobClient(filePath);
    const options: BlockBlobParallelUploadOptions = {
      blobHTTPHeaders: {
        blobContentType: contentType,
      },
    };
    const blockBlobUploadResponse: BlockBlobUploadResponse =
      await blockBlobClient.upload(data, data.length, options);
    if (blockBlobUploadResponse.errorCode) {
      throw new Error(blockBlobUploadResponse.errorCode);
    }
    return;
  };

  (lib as any).listFiles = async () => {
    if (!lib.getIsReadable()) {
      throw new Error('Azure is not configured.');
    }

    const files: FileMeta[] = [];
    const containerClient = await getContainerClient();

    for await (const blob of containerClient.listBlobsFlat({
      includeMetadata: false,
      includeSnapshots: false,
      includeTags: false,
      includeVersions: false,
      prefix: '',
    })) {
      files.push({ name: blob.name, size: blob.properties.contentLength || 0 });
    }

    return files;
  };

  return lib;
};
