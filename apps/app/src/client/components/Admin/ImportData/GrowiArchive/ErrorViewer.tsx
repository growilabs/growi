import React, { type JSX } from 'react';

import { Modal, ModalHeader, ModalBody } from 'reactstrap';

type ErrorViewerProps = {
  isOpen: boolean,
  errors: any[],
  onClose: () => void,
}

const ErrorViewer = (props: ErrorViewerProps): JSX.Element => {
  const { errors } = props;

  let value = '(no errors)';
  if (errors != null && errors.length > 0) {
    const lines = errors.map((obj) => {
      return JSON.stringify(obj);
    });
    value = lines.join('\n');
  }

  return (
    <Modal isOpen={props.isOpen} toggle={props.onClose} size="lg">
      <ModalHeader tag="h4" toggle={props.onClose} className="text-danger">
        Errors
      </ModalHeader>
      <ModalBody>
        <textarea className="form-control" rows={8} readOnly wrap="off" defaultValue={value}></textarea>
      </ModalBody>
    </Modal>
  );
};

export default ErrorViewer;
