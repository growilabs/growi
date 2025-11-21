import React, { useCallback, useState, type JSX } from 'react';


import { isPopulated } from '@growi/core';
import { useTranslation } from 'next-i18next';

import ImageCropModal from '~/client/components/Common/ImageCropModal';
import { apiPost, apiPostForm } from '~/client/util/apiv1-client';
import { apiv3Put } from '~/client/util/apiv3-client';
import { toastSuccess, toastError } from '~/client/util/toastr';
import { useCurrentUser } from '~/states/global';
import { generateGravatarSrc, GRAVATAR_DEFAULT } from '~/utils/gravatar';

const DEFAULT_IMAGE = '/images/icons/user.svg';


const ProfileImageSettings = (): JSX.Element => {
  const { t } = useTranslation();

  const currentUser = useCurrentUser();

  const [isGravatarEnabled, setGravatarEnabled] = useState(currentUser?.isGravatarEnabled);
  const [uploadedPictureSrc, setUploadedPictureSrc] = useState(() => {
    if (currentUser?.imageAttachment != null && isPopulated(currentUser.imageAttachment)) {
      return currentUser.imageAttachment.filePathProxied ?? currentUser.image;
    }
    return currentUser?.image;
  });

  const [showImageCropModal, setShowImageCropModal] = useState(false);
  const [imageCropSrc, setImageCropSrc] = useState<string|ArrayBuffer|null>(null);

  const selectFileHandler = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files == null || e.target.files.length === 0) {
      return;
    }

    const reader = new FileReader();
    reader.addEventListener('load', () => setImageCropSrc(reader.result));
    reader.readAsDataURL(e.target.files[0]);

    setShowImageCropModal(true);
  }, []);

  const processImageCompletedHandler = useCallback(async(croppedImage) => {
    try {
      const formData = new FormData();
      formData.append('file', croppedImage);
      const response = await apiPostForm('/attachments.uploadProfileImage', formData);

      toastSuccess(t('toaster.update_successed', { target: t('Current Image'), ns: 'commons' }));

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setUploadedPictureSrc((response as any).attachment.filePathProxied);

    }
    catch (err) {
      toastError(err);
    }
  }, [t]);

  const deleteImageHandler = useCallback(async() => {
    try {
      await apiPost('/attachments.removeProfileImage');

      setUploadedPictureSrc(undefined);
      toastSuccess(t('toaster.update_successed', { target: t('Current Image'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [t]);

  const submit = useCallback(async() => {
    try {
      const response = await apiv3Put('/personal-setting/image-type', { isGravatarEnabled });

      const { userData } = response.data;
      setGravatarEnabled(userData.isGravatarEnabled);

      toastSuccess(t('toaster.update_successed', { target: t('Set Profile Image'), ns: 'commons' }));
    }
    catch (err) {
      toastError(err);
    }
  }, [isGravatarEnabled, t]);

  if (currentUser == null) {
    return <></>;
  }

  return (
    <>
      <div className="row justify-content-around mt-5 mt-md-4">
        <div className="col-md-3">
          <h5>
            <div className="form-check radio-primary">
              <input
                type="radio"
                id="radioGravatar"
                className="form-check-input"
                form="formImageType"
                name="imagetypeForm[isGravatarEnabled]"
                checked={isGravatarEnabled}
                onChange={() => setGravatarEnabled(true)}
              />
              <label className="form-label form-check-label" htmlFor="radioGravatar">
                <img src={GRAVATAR_DEFAULT} className="me-1" data-vrt-blackout-profile /> Gravatar
              </label>
              <a href="https://gravatar.com/" target="_blank" rel="noopener noreferrer">
                <small><span className="material-symbols-outlined ms-2 text-secondary" aria-hidden="true">info</span></small>
              </a>
            </div>
          </h5>
          <img src={generateGravatarSrc(currentUser.email)} className="rounded-pill" width="64" height="64" data-vrt-blackout-profile />
        </div>

        <div className="col-md-7 mt-5 mt-md-0">
          <h5>
            <div className="form-check radio-primary">
              <input
                type="radio"
                id="radioUploadPicture"
                className="form-check-input"
                form="formImageType"
                name="imagetypeForm[isGravatarEnabled]"
                checked={!isGravatarEnabled}
                onChange={() => setGravatarEnabled(false)}
              />
              <label className="form-label form-check-label" htmlFor="radioUploadPicture">
                { t('Upload Image') }
              </label>
            </div>
          </h5>
          <div className="row mt-3">
            <label className="col-md-6 col-lg-4 col-form-label text-start">
              { t('Current Image') }
            </label>
            <div className="col-md-6 col-lg-8">
              <p className="mb-0">
                <img src={uploadedPictureSrc ?? DEFAULT_IMAGE} width="64" height="64" className="rounded-circle" id="settingUserPicture" />
              </p>
              {uploadedPictureSrc && <button type="button" className="btn btn-danger mt-2" onClick={deleteImageHandler}>{ t('Delete Image') }</button>}
            </div>
          </div>
          <div className="row align-items-center mt-3 mt-md-5">
            <label className="col-md-6 col-lg-4 col-form-label text-start mt-3 mt-md-0">
              {t('Upload new image')}
            </label>
            <div className="col-md-6 col-lg-8">
              <input
                type="file"
                onChange={selectFileHandler}
                name="profileImage"
                accept="image/png,image/jpeg,image/jpg,image/gif,image/webp,image/avif,image/heic,image/heif,image/tiff,image/svg+xml"
              />
            </div>
          </div>
        </div>
      </div>

      <ImageCropModal
        isShow={showImageCropModal}
        src={imageCropSrc}
        onModalClose={() => setShowImageCropModal(false)}
        onImageProcessCompleted={processImageCompletedHandler}
        isCircular
        showCropOption
      />

      <div className="row mt-4">
        <div className="offset-4 col-5">
          <button type="button" className="btn btn-primary" onClick={submit}>
            {t('Update')}
          </button>
        </div>
      </div>

    </>
  );

};

export default ProfileImageSettings;
