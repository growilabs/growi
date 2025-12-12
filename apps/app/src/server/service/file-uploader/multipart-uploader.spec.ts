import { MultipartUploader, UploadStatus } from './multipart-uploader';

class MockMultipartUploader extends MultipartUploader {
  async initUpload(): Promise<void> {
    return;
  }

  async uploadPart(part: Buffer, partNumber: number): Promise<void> {
    return;
  }

  async completeUpload(): Promise<void> {
    return;
  }

  async abortUpload(): Promise<void> {
    return;
  }

  async getUploadedFileSize(): Promise<number> {
    return 0;
  }

  // Expose the protected method for testing
  testValidateUploadStatus(desired: UploadStatus): void {
    this.validateUploadStatus(desired);
  }

  setCurrentStatus(status: UploadStatus): void {
    this.currentStatus = status;
  }
}

describe('MultipartUploader', () => {
  let uploader: MockMultipartUploader;

  beforeEach(() => {
    uploader = new MockMultipartUploader('test-upload-key', 10485760);
  });

  describe('validateUploadStatus', () => {
    describe('When current status is equal to desired status', () => {
      it('should not throw error', () => {
        uploader.setCurrentStatus(UploadStatus.ABORTED);
        expect(() =>
          uploader.testValidateUploadStatus(UploadStatus.ABORTED),
        ).not.toThrow();
      });
    });

    describe('When current status is not equal to desired status', () => {
      const cases = [
        {
          current: UploadStatus.BEFORE_INIT,
          desired: UploadStatus.IN_PROGRESS,
          errorMessage: 'Multipart upload has not been initiated',
        },
        {
          current: UploadStatus.BEFORE_INIT,
          desired: UploadStatus.COMPLETED,
          errorMessage: 'Multipart upload has not been initiated',
        },
        {
          current: UploadStatus.BEFORE_INIT,
          desired: UploadStatus.ABORTED,
          errorMessage: 'Multipart upload has not been initiated',
        },
        {
          current: UploadStatus.IN_PROGRESS,
          desired: UploadStatus.BEFORE_INIT,
          errorMessage: 'Multipart upload is already in progress',
        },
        {
          current: UploadStatus.IN_PROGRESS,
          desired: UploadStatus.COMPLETED,
          errorMessage: 'Multipart upload is still in progress',
        },
        {
          current: UploadStatus.IN_PROGRESS,
          desired: UploadStatus.ABORTED,
          errorMessage: 'Multipart upload is still in progress',
        },
        {
          current: UploadStatus.COMPLETED,
          desired: UploadStatus.BEFORE_INIT,
          errorMessage: 'Multipart upload has already been completed',
        },
        {
          current: UploadStatus.COMPLETED,
          desired: UploadStatus.IN_PROGRESS,
          errorMessage: 'Multipart upload has already been completed',
        },
        {
          current: UploadStatus.COMPLETED,
          desired: UploadStatus.ABORTED,
          errorMessage: 'Multipart upload has already been completed',
        },
        {
          current: UploadStatus.ABORTED,
          desired: UploadStatus.BEFORE_INIT,
          errorMessage: 'Multipart upload has been aborted',
        },
        {
          current: UploadStatus.ABORTED,
          desired: UploadStatus.IN_PROGRESS,
          errorMessage: 'Multipart upload has been aborted',
        },
        {
          current: UploadStatus.ABORTED,
          desired: UploadStatus.COMPLETED,
          errorMessage: 'Multipart upload has been aborted',
        },
      ];

      describe.each(cases)(
        'When current status is $current and desired status is $desired',
        ({ current, desired, errorMessage }) => {
          beforeEach(() => {
            uploader.setCurrentStatus(current);
          });

          it(`should throw expected error: "${errorMessage}"`, () => {
            expect(() => uploader.testValidateUploadStatus(desired)).toThrow(
              errorMessage,
            );
          });
        },
      );
    });
  });
});
