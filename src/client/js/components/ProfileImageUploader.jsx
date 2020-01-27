import React from 'react';
import PropTypes from 'prop-types';
import Modal from 'react-bootstrap/es/Modal';
import Button from 'react-bootstrap/es/Button';
import { withTranslation } from 'react-i18next';

import ReactCrop from 'react-image-crop';
import AppContainer from '../services/AppContainer';
import { createSubscribedElement } from './UnstatedUtils';
import 'react-image-crop/dist/ReactCrop.css';

class ProfileImageUploader extends React.Component {

  // demo: https://codesandbox.io/s/72py4jlll6
  constructor(props) {
    super();

    this.state = {
      src: null,
      crop: null,
    };

    this.onSelectFile = this.onSelectFile.bind(this);
    this.onImageLoaded = this.onImageLoaded.bind(this);
    this.onCropComplete = this.onCropComplete.bind(this);
    this.onCropChange = this.onCropChange.bind(this);
    this.makeClientCrop = this.makeClientCrop.bind(this);
    this.getCroppedImg = this.getCroppedImg.bind(this);
    this.hanndleSubmit = this.handleSubmit.bind(this);
    this.cancel = this.cancel.bind(this);
    this.reset = this.reset.bind(this);
  }

  onSelectFile(e) {
    if (e.target.files && e.target.files.length > 0) {
      const reader = new FileReader();
      reader.addEventListener('load', () => this.setState({ src: reader.result }));
      reader.readAsDataURL(e.target.files[0]);
    }
    this.show();
  }

  onImageLoaded(image) {
    this.imageRef = image;
    this.reset();
    return false; // Return false when setting crop state in here.
  }

  onCropComplete(crop) {
    this.makeClientCrop(crop);
  }

  onCropChange(crop) {
    this.setState({ crop });
  }

  async makeClientCrop(crop) {
    // GW-201 で crop済みの画像を state におくときにコメントを外す（未使用変数の lint エラーが生じるためコメントアウト)
    if (this.imageRef && crop.width && crop.height) {
      const croppedImageUrl = await this.getCroppedImg(this.imageRef, crop, '/images/icons/user');
      this.setState({ croppedImageUrl });
    }
  }

  async getCroppedImg(image, crop, fileName) {
    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    canvas.width = crop.width;
    canvas.height = crop.height;
    const ctx = canvas.getContext('2d');

    ctx.drawImage(image, crop.x * scaleX, crop.y * scaleY, crop.width * scaleX, crop.height * scaleY,
      0, 0, crop.width, crop.height);

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) {
          reject(new Error('Canvas is empty'));
          return;
        }
        blob.name = fileName;
        window.URL.revokeObjectURL(this.fileUrl);
        this.fileUrl = window.URL.createObjectURL(blob);
        resolve(this.fileUrl);
      }, 'image/jpeg');
    });
  }

  handleSubmit() {
    // GW-201 にて、crop された画像をサーバー側に送る処理を記述する
    // me/index.html の 199~240行目の
    // `$("#pictureUploadForm input[name=profileImage]").on('change', function(){...}`
    // の処理を node で記述
  }

  show() {
    this.setState({ show: true });
  }

  hide() {
    this.setState({ show: false });
  }

  cancel() {
    this.hide();
  }

  reset() {
    const size = Math.min(this.imageRef.width, this.imageRef.height);
    this.setState({
      crop: {
        unit: 'px',
        x: (this.imageRef.width / 2) - (size / 2),
        y: (this.imageRef.height / 2) - (size / 2),
        width: size,
        height: size,
        aspect: 1,
      },
    });
  }

  render() {
    const { t } = this.props;
    const { crop, src } = this.state;

    return (
      <div className="ProfileImageUploader">
        <div className="form-group">
          <label htmlFfor="" className="col-sm-4 control-label">
            {t('Upload new image')}
          </label>
        </div>
        <input type="file" onChange={this.onSelectFile} name="profileImage" accept="image/*" />
        {src
        && (
          <Modal show={this.state.show} onHide={this.cancel}>
            <Modal.Header closeButton>
              <Modal.Title>Image Crop</Modal.Title>
            </Modal.Header>
            <Modal.Body className="my-5">
              <ReactCrop
                src={src}
                crop={crop}
                circularCrop
                onImageLoaded={this.onImageLoaded}
                onComplete={this.onCropComplete}
                onChange={this.onCropChange}
              />
            </Modal.Body>
            <Modal.Footer>
              <div className="d-flex justify-content-between">
                <Button bsStyle="danger" onClick={this.reset}>Reset</Button>
                <div className="d-flex">
                  <Button bsStyle="default" onClick={this.cancel}>Cancel</Button>
                  <Button bsStyle="primary" onClick={this.handleSubmit}>Crop</Button>
                </div>
              </div>
            </Modal.Footer>
          </Modal>
        )}
      </div>
    );
  }

}

/**
 * Wrapper component for using unstated
 */
const ProfileImageFormWrapper = (props) => {
  return createSubscribedElement(ProfileImageUploader, props, [AppContainer]);
};

ProfileImageUploader.propTypes = {
  t: PropTypes.func.isRequired, // i18next
  appContainer: PropTypes.instanceOf(AppContainer).isRequired,
};

export default withTranslation()(ProfileImageFormWrapper);
