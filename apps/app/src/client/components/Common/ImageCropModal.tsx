import type { FC } from 'react';
import React, { useCallback, useEffect, useState } from 'react';

import canvasToBlob from 'async-canvas-to-blob';
import { useTranslation } from 'react-i18next';
import ReactCrop from 'react-image-crop';
import {
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from 'reactstrap';


import { toastError } from '~/client/util/toastr';
import loggerFactory from '~/utils/logger';
import 'react-image-crop/dist/ReactCrop.css';

const logger = loggerFactory('growi:ImageCropModal');

interface ICropOptions {
  aspect: number
  unit: string,
  x: number
  y: number
  width: number,
  height: number,
}

type CropOptions = ICropOptions | null

type Props = {
  isShow: boolean,
  src: string | ArrayBuffer | null,
  onModalClose: () => void,
  onImageProcessCompleted: (res: any) => void,
  isCircular: boolean,
  showCropOption: boolean
}
const ImageCropModal: FC<Props> = (props: Props) => {

  const {
    isShow, src, onModalClose, onImageProcessCompleted, isCircular, showCropOption,
  } = props;

  const [imageRef, setImageRef] = useState<HTMLImageElement | null>(null);
  const [cropOptions, setCropOtions] = useState<CropOptions>(null);
  const [isCropImage, setIsCropImage] = useState<boolean>(true);
  const { t } = useTranslation('commons');

  const reset = useCallback(() => {
    if (imageRef) {
      // Some SVG files may not have width and height properties, causing the render size to be 0x0
      // Force imageRef to have width and height by create temporary image element then set the imageRef width with tempImage width
      // Set imageRef width & height by natural width / height if image has no dimension
      if (imageRef.width === 0 || imageRef.height === 0) {
        imageRef.width = imageRef.naturalWidth;
        imageRef.height = imageRef.naturalHeight;
      }
      // Get size of Image, min value of width and height
      const size = Math.min(imageRef.width, imageRef.height);
      setCropOtions({
        aspect: 1,
        unit: 'px',
        x: imageRef.width / 2 - size / 2,
        y: imageRef.height / 2 - size / 2,
        width: size,
        height: size,
      });
    }
  }, [imageRef]);

  useEffect(() => {
    document.body.style.position = 'static';
    setIsCropImage(true);
    reset();
  }, [reset]);

  // Memoize image processing functions
  const onImageLoaded = useCallback((image) => {
    setImageRef(image);
    reset();
    return false;
  }, [reset]);

  const getCroppedImg = useCallback(async(image: HTMLImageElement, crop: ICropOptions) => {
    const {
      naturalWidth: imageNaturalWidth, naturalHeight: imageNaturalHeight, width: imageWidth, height: imageHeight,
    } = image;

    const {
      width: cropWidth, height: cropHeight, x, y,
    } = crop;

    const canvas = document.createElement('canvas');
    const scaleX = imageNaturalWidth / imageWidth;
    const scaleY = imageNaturalHeight / imageHeight;
    canvas.width = cropWidth;
    canvas.height = cropHeight;
    const ctx = canvas.getContext('2d');
    ctx?.drawImage(image, x * scaleX, y * scaleY, cropWidth * scaleX, cropHeight * scaleY, 0, 0, cropWidth, cropHeight);
    try {
      const blob = await canvasToBlob(canvas);
      return blob;
    }
    catch (err) {
      logger.error(err);
      toastError(new Error('Failed to draw image'));
    }
  }, []);

  // Convert base64 Image to blob
  const convertBase64ToBlob = useCallback(async(base64Image: string) => {
    const base64Response = await fetch(base64Image);
    return base64Response.blob();
  }, []);


  // Memoize event handlers
  const onModalCloseHandler = useCallback(async() => {
    setImageRef(null);
    onModalClose();
  }, [onModalClose]);

  const processAndSaveImage = useCallback(async() => {
    if (imageRef && cropOptions?.width && cropOptions.height) {
      const processedImage = isCropImage ? await getCroppedImg(imageRef, cropOptions) : await convertBase64ToBlob(imageRef.src);
      // Save image to database
      onImageProcessCompleted(processedImage);
    }
    onModalCloseHandler();
  }, [imageRef, cropOptions, isCropImage, getCroppedImg, convertBase64ToBlob, onImageProcessCompleted, onModalCloseHandler]);

  const toggleCropMode = useCallback(() => setIsCropImage(!isCropImage), [isCropImage]);
  const handleCropChange = useCallback((crop: CropOptions) => setCropOtions(crop), []);

  return (
    <Modal isOpen={isShow} toggle={onModalCloseHandler}>
      {isShow && (
        <>
          <ModalHeader tag="h4" toggle={onModalCloseHandler} className="text-info">
            {t('crop_image_modal.image_crop')}
          </ModalHeader>
          <ModalBody className="my-4">
            {
              isCropImage
                ? (
                  <ReactCrop
                    style={{ backgroundColor: 'transparent' }}
                    src={src}
                    crop={cropOptions}
                    onImageLoaded={onImageLoaded}
                    onChange={handleCropChange}
                    circularCrop={isCircular}
                  />
                )
                : (<img style={{ maxWidth: imageRef?.width }} src={imageRef?.src} />)
            }
          </ModalBody>
          <ModalFooter>
            <button type="button" className="btn btn-outline-danger rounded-pill me-auto" disabled={!isCropImage} onClick={reset}>
              {t('commons:Reset')}
            </button>
            { !showCropOption && (
              <div className="me-auto">
                <div className="form-check form-switch">
                  <input
                    id="cropImageOption"
                    className="form-check-input me-auto"
                    type="checkbox"
                    checked={isCropImage}
                    onChange={toggleCropMode}
                  />
                  <label className="form-label form-check-label" htmlFor="cropImageOption">
                    { t('crop_image_modal.image_crop') }
                  </label>
                </div>
              </div>
            )
            }
            <button type="button" className="btn btn-outline-secondary rounded-pill me-2" onClick={onModalCloseHandler}>
              {t('crop_image_modal.cancel')}
            </button>
            <button type="button" className="btn btn-outline-primary rounded-pill" onClick={processAndSaveImage}>
              { isCropImage ? t('crop_image_modal.crop') : t('crop_image_modal.save') }
            </button>
          </ModalFooter>
        </>
      )}
    </Modal>
  );
};

export default ImageCropModal;
