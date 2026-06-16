import React, { type JSX, useCallback, useRef, useState } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';
import { useTranslation } from 'react-i18next';

import ImageCropModal from '~/client/components/Common/ImageCropModal';
import {
  apiv3Delete,
  apiv3PostForm,
  apiv3Put,
} from '~/client/util/apiv3-client';
import { toastError, toastSuccess } from '~/client/util/toastr';
import { useIsDefaultLogo } from '~/states/global';
import { isCustomizedLogoUploadedAtom } from '~/states/server-configurations';

import AdminUpdateButtonRow from '../Common/AdminUpdateButtonRow';

const DEFAULT_LOGO = '/images/logo.svg';
const CUSTOMIZED_LOGO = '/attachment/brand-logo';

const CustomizeLogoSetting = (): JSX.Element => {
  const { t } = useTranslation();
  const isDefaultLogo = useIsDefaultLogo();
  const isCustomizedLogoUploaded = useAtomValue(isCustomizedLogoUploadedAtom);
  const setIsCustomizedLogoUploaded = useSetAtom(isCustomizedLogoUploadedAtom);

  const [uploadLogoSrc, setUploadLogoSrc] = useState<
    ArrayBuffer | string | null
  >(null);
  const [isImageCropModalShow, setIsImageCropModalShow] =
    useState<boolean>(false);
  const [isDefaultLogoSelected, setIsDefaultLogoSelected] = useState<boolean>(
    isDefaultLogo ?? true,
  );
  const [retrieveError, setRetrieveError] = useState<any>();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const isSystemError: boolean = retrieveError != null;
  const isLogoSettingIncomplete: boolean =
    !isDefaultLogoSelected &&
    uploadLogoSrc == null &&
    !isCustomizedLogoUploaded;
  const isUpdateButtonDisabled: boolean =
    isSystemError || isLogoSettingIncomplete;

  const onSelectFile = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files != null && e.target.files.length > 0) {
      const reader = new FileReader();
      reader.addEventListener('load', () => setUploadLogoSrc(reader.result));
      reader.readAsDataURL(e.target.files[0]);
      setIsImageCropModalShow(true);
    }
  }, []);

  const onClickSubmit = useCallback(async () => {
    try {
      await apiv3Put('/customize-setting/customize-logo', {
        isDefaultLogo: isDefaultLogoSelected,
      });
      toastSuccess(
        t('toaster.update_successed', {
          target: t('admin:customize_settings.custom_logo'),
          ns: 'commons',
        }),
      );
    } catch (err) {
      toastError(err);
    }
  }, [t, isDefaultLogoSelected]);

  const clearFileInput = useCallback(() => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  }, []);

  const resetFileSelectionState = useCallback(() => {
    clearFileInput();
    setUploadLogoSrc(null);
  }, [clearFileInput]);

  const onCloseCropModal = useCallback(() => {
    resetFileSelectionState();
    setIsImageCropModalShow(false);
  }, [resetFileSelectionState]);

  const onClickDeleteBtn = useCallback(async () => {
    try {
      await apiv3Delete('/customize-setting/delete-brand-logo');
      setIsCustomizedLogoUploaded(false);
      toastSuccess(
        t('toaster.update_successed', {
          target: t('admin:customize_settings.current_logo'),
          ns: 'commons',
        }),
      );
      resetFileSelectionState();
    } catch (err) {
      toastError(err);
      setRetrieveError(err);
      throw new Error('Failed to delete logo');
    }
  }, [setIsCustomizedLogoUploaded, t, resetFileSelectionState]);

  const processImageCompletedHandler = useCallback(
    async (croppedImage) => {
      try {
        const formData = new FormData();
        formData.append('file', croppedImage);
        await apiv3PostForm('/customize-setting/upload-brand-logo', formData);
        setIsCustomizedLogoUploaded(true);
        toastSuccess(
          t('toaster.update_successed', {
            target: t('admin:customize_settings.current_logo'),
            ns: 'commons',
          }),
        );
      } catch (err) {
        toastError(err);
        setRetrieveError(err);
        throw new Error('Failed to upload brand logo');
      }
    },
    [setIsCustomizedLogoUploaded, t],
  );

  return (
    <React.Fragment>
      <div className="row">
        <div className="col-12">
          <div className="mb-5">
            <h2 className="border-bottom my-4 admin-setting-header">
              {t('admin:customize_settings.custom_logo')}
            </h2>
            <div className="row">
              <div className="col-md-6 col-12 mb-3 mb-md-0">
                <h4>
                  <div className="form-check radio-primary">
                    <input
                      type="radio"
                      id="radioDefaultLogo"
                      className="form-check-input"
                      form="formImageType"
                      name="imagetypeForm[isDefaultLogo]"
                      checked={isDefaultLogoSelected}
                      onChange={() => {
                        setIsDefaultLogoSelected(true);
                      }}
                    />
                    <label
                      className="form-check-label"
                      htmlFor="radioDefaultLogo"
                    >
                      {t('admin:customize_settings.default_logo')}
                    </label>
                  </div>
                </h4>
                <img
                  src={DEFAULT_LOGO}
                  width="64"
                  alt={t('admin:customize_settings.default_logo')}
                />
              </div>
              <div className="col-md-6 col-12">
                <h4>
                  <div className="form-check radio-primary">
                    <input
                      type="radio"
                      id="radioUploadLogo"
                      className="form-check-input"
                      form="formImageType"
                      name="imagetypeForm[isDefaultLogo]"
                      checked={!isDefaultLogoSelected}
                      onChange={() => {
                        setIsDefaultLogoSelected(false);
                      }}
                    />
                    <label
                      className="form-check-label"
                      htmlFor="radioUploadLogo"
                    >
                      {t('admin:customize_settings.upload_logo')}
                    </label>
                  </div>
                </h4>
                <div className="row mb-3">
                  <span className="col-sm-4 col-12 col-form-label text-start">
                    {t('admin:customize_settings.current_logo')}
                  </span>
                  <div className="col-sm-8 col-12">
                    {isCustomizedLogoUploaded && (
                      <>
                        <p>
                          <img
                            src={CUSTOMIZED_LOGO}
                            id="settingBrandLogo"
                            width="64"
                            alt={t('admin:customize_settings.current_logo')}
                          />
                        </p>
                        <button
                          type="button"
                          className="btn btn-danger"
                          onClick={onClickDeleteBtn}
                        >
                          {t('admin:customize_settings.delete_logo')}
                        </button>
                      </>
                    )}
                  </div>
                </div>
                <div className="row">
                  <label
                    className="col-sm-4 col-12 col-form-label text-start"
                    htmlFor="uploadLogoInput"
                  >
                    {t('admin:customize_settings.upload_new_logo')}
                  </label>
                  <div className="col-sm-8 col-12">
                    <input
                      id="uploadLogoInput"
                      type="file"
                      onChange={onSelectFile}
                      name="brandLogo"
                      accept="image/*"
                      ref={fileInputRef}
                    />
                  </div>
                </div>
              </div>
            </div>
            <AdminUpdateButtonRow
              onClick={onClickSubmit}
              disabled={isUpdateButtonDisabled}
            />
          </div>
        </div>
      </div>

      <ImageCropModal
        isShow={isImageCropModalShow}
        src={uploadLogoSrc}
        onModalClose={onCloseCropModal}
        onImageProcessCompleted={processImageCompletedHandler}
        isCircular={false}
        showCropOption={false}
      />
    </React.Fragment>
  );
};

export default CustomizeLogoSetting;
