import React, { useEffect, useState, useCallback } from 'react';

import { ModalBody, ModalHeader, ModalFooter } from 'reactstrap';

import { apiPost } from '~/client/util/apiv1-client';
import { apiv3Get } from '~/client/util/apiv3-client';
import { useImageEditorModal } from '~/stores/modal';

type HistoryItem = {
  _id: string;
  originalName: string;
  fileSize: string;
  createdAt: string;
  filePathProxied: string;
};

type Props = {
  onClickTransitionEditButton: () => void;
  onRestoreClick: (id: string) => void;
  setSelectedAttachmentId: (id: string | null) => void;
};

export const ImageEditorHistoryModal = (props: Props): JSX.Element => {
  const {
    onClickTransitionEditButton, onRestoreClick, setSelectedAttachmentId,
  } = props;

  const { data: imageEditorModalData } = useImageEditorModal();
  const currentAttachmentId = imageEditorModalData?.imageSrc?.replace('/attachment/', '');

  const [attachmentHistory, setAttachmentHistory] = useState<{ history: Array<HistoryItem> } | null>(null);
  const [maxHeight, setMaxHeight] = useState('70vh');

  const getAttachmentsHistory = useCallback(async() => {
    if (currentAttachmentId == null) {
      return;
    }

    try {
      const res = await apiv3Get(`/attachment/history/${currentAttachmentId}`);
      setAttachmentHistory(res.data);
    }
    catch (err) {
      console.error(err);
    }
  }, [currentAttachmentId]);

  const deleteAttachment = async(attachmentId: string) => {
    try {
      await apiPost('/attachments.remove', { attachment_id: attachmentId });
      await getAttachmentsHistory();
      setSelectedAttachmentId(null);
    }
    catch (err) {
      // error handling
    }
  };

  useEffect(() => {
    if (currentAttachmentId == null) {
      return;
    }

    getAttachmentsHistory();
  }, [getAttachmentsHistory, currentAttachmentId]);

  useEffect(() => {
    const updateMaxHeight = () => setMaxHeight(`${window.innerHeight * 0.7}px`);
    window.addEventListener('resize', updateMaxHeight);

    return () => window.removeEventListener('resize', updateMaxHeight);
  }, []);

  const formatDate = (dateString: string) => {
    const options = {
      year: 'numeric' as const,
      month: 'long' as const,
      day: 'numeric' as const,
      hour: '2-digit' as const,
      minute: '2-digit' as const,
      second: '2-digit' as const,
    };
    return new Date(dateString).toLocaleString('ja-JP', options);
  };

  return (
    <>
      <ModalHeader className="bg-primary text-light">
        編集履歴
      </ModalHeader>

      <ModalBody className="mx-auto" style={{ maxHeight, overflowY: 'auto' }}>
        {
          attachmentHistory
            ? attachmentHistory.history.map(item => (
              <div key={item._id}>
                <div className="row">
                  <div className="col-4 mb-4">
                    <img src={item.filePathProxied} alt={item.originalName} className="img-fluid" />
                  </div>
                  <div className="col-8">
                    <a href={item.filePathProxied} target="_blank" rel="noopener noreferrer">
                      <p>{item.originalName} ({item.filePathProxied})</p>
                    </a>
                    <p>サイズ: {item.fileSize}バイト</p>
                    <p>作成日: {formatDate(item.createdAt)}</p>

                    { item._id === currentAttachmentId && (
                      <p className="text-muted">現在のバージョン</p>
                    )}

                    {
                      item._id !== currentAttachmentId && (
                        <>
                          <button type="button" className="btn btn-secondary" onClick={() => onRestoreClick(item._id)}>復元</button>
                          <button type="button" className="btn text-danger" onClick={() => deleteAttachment(item._id)}>
                            <i className="icon-fw icon-trash" />
                          </button>
                        </>
                      )
                    }
                  </div>
                </div>
                <div className="border mb-4"></div>
              </div>
            ))
            : 'No history available'
        }
      </ModalBody>

      <ModalFooter>
        <button type="button" className="btn btn-outline-secondary mr-2 mx-auto" onClick={() => onClickTransitionEditButton()}>編集に戻る</button>
      </ModalFooter>
    </>
  );
};
