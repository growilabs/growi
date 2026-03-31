import { type JSX, useId, useState } from 'react';
import { AcceptedUploadFileType } from '@growi/core';
import { useTranslation } from 'react-i18next';
import {
  Dropdown,
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
  UncontrolledTooltip,
} from 'reactstrap';

import type { GlobalCodeMirrorEditorKey } from '../../../../consts';
import { AttachmentsDropdownItem } from './AttachmentsDropdownItem';
import { LinkEditButton } from './LinkEditButton';

import styles from './AttachmentsDropup.module.scss';

const btnAttachmentToggleClass = styles['btn-attachment-toggle'];

type Props = {
  editorKey: string | GlobalCodeMirrorEditorKey;
  acceptedUploadFileType: AcceptedUploadFileType;
  onUpload?: (files: File[]) => void;
};

export const AttachmentsDropup = (props: Props): JSX.Element => {
  const { acceptedUploadFileType, editorKey, onUpload } = props;

  const [isOpen, setOpen] = useState(false);

  const id = useId();
  const { t } = useTranslation('commons');

  return (
    <>
      <Dropdown
        isOpen={isOpen}
        toggle={() => setOpen(!isOpen)}
        direction="up"
        className="lh-1"
      >
        <DropdownToggle
          id={id}
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
      {!isOpen && (
        <UncontrolledTooltip placement="top" target={CSS.escape(id)}>
          {t('toolbar.attachments')}
        </UncontrolledTooltip>
      )}
    </>
  );
};
