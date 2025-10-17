import { AcceptedUploadFileType } from '@growi/core';
import { type JSX, useState } from 'react';
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
} from 'reactstrap';

import type { GlobalCodeMirrorEditorKey } from '../../../../consts';
import { AttachmentsDropdownItem } from './AttachmentsDropdownItem';
import styles from './AttachmentsDropup.module.scss';
import { LinkEditButton } from './LinkEditButton';

const btnAttachmentToggleClass = styles['btn-attachment-toggle'];

type Props = {
  editorKey: string | GlobalCodeMirrorEditorKey;
  acceptedUploadFileType: AcceptedUploadFileType;
  onUpload?: (files: File[]) => void;
};

export const AttachmentsDropup = (props: Props): JSX.Element => {
  const { acceptedUploadFileType, editorKey, onUpload } = props;

  const [isOpen, setOpen] = useState(false);

  return (
    <>
      <Dropdown
        isOpen={isOpen}
        toggle={() => setOpen(!isOpen)}
        direction="up"
        className="lh-1"
      >
        <DropdownToggle
          className={`${btnAttachmentToggleClass} btn-toolbar-button rounded-circle`}
          color="unset"
        >
          <span className="material-symbols-outlined fs-6">add</span>
        </DropdownToggle>
        <DropdownMenu>
          <DropdownItem className="mt-1" header>
            Attachments
          </DropdownItem>

          <DropdownItem divider />

          {acceptedUploadFileType === AcceptedUploadFileType.ALL && (
            <AttachmentsDropdownItem
              acceptedUploadFileType={AcceptedUploadFileType.ALL}
              onUpload={onUpload}
              onClose={() => setOpen(false)}
            >
              <span className="material-symbols-outlined fs-5">
                attach_file
              </span>
              Files
            </AttachmentsDropdownItem>
          )}

          {acceptedUploadFileType !== AcceptedUploadFileType.NONE && (
            <AttachmentsDropdownItem
              acceptedUploadFileType={AcceptedUploadFileType.IMAGE}
              onUpload={onUpload}
              onClose={() => setOpen(false)}
            >
              <span className="material-symbols-outlined fs-5">image</span>
              Images
            </AttachmentsDropdownItem>
          )}

          <LinkEditButton editorKey={editorKey} />
        </DropdownMenu>
      </Dropdown>
    </>
  );
};
