import { type FC, useCallback } from 'react';
import { useTranslation } from 'next-i18next';
import { Modal, ModalBody, ModalHeader } from 'reactstrap';

type Props = {
  isOpen: boolean;
  includeUserPages: boolean;
  includeTrashPages: boolean;
  disableUserPages: boolean;
  onClose?: () => void;
  onIncludeUserPagesSwitched?: (isChecked: boolean) => void;
  onIncludeTrashPagesSwitched?: (isChecked: boolean) => void;
};

export const SearchOptionModal: FC<Props> = (props: Props) => {
  const { t } = useTranslation('');

  const {
    isOpen,
    includeUserPages,
    includeTrashPages,
    disableUserPages,
    onClose,
    onIncludeUserPagesSwitched,
    onIncludeTrashPagesSwitched,
  } = props;

  // Memoize event handlers
  const onCloseModal = useCallback(() => {
    if (onClose != null) {
      onClose();
    }
  }, [onClose]);

  const includeUserPagesChangeHandler = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (onIncludeUserPagesSwitched != null) {
        onIncludeUserPagesSwitched(e.target.checked);
      }
    },
    [onIncludeUserPagesSwitched],
  );

  const includeTrashPagesChangeHandler = useCallback(
    (isChecked: boolean) => {
      if (onIncludeTrashPagesSwitched != null) {
        onIncludeTrashPagesSwitched(isChecked);
      }
    },
    [onIncludeTrashPagesSwitched],
  );

  return (
    <Modal size="lg" isOpen={isOpen} toggle={onCloseModal} autoFocus={false}>
      <ModalHeader tag="h4" toggle={onCloseModal}>
        Search Option
      </ModalHeader>
      <ModalBody>
        <div className="d-flex p-2">
          {!disableUserPages && (
            <div className="me-3">
              <label className="form-label px-3 py-2 mb-0 d-flex align-items-center">
                <input
                  className="me-2"
                  type="checkbox"
                  onChange={includeUserPagesChangeHandler}
                  checked={includeUserPages}
                />
                {t('Include Subordinated Target Page', { target: '/user' })}
              </label>
            </div>
          )}
          <div className="">
            <label className="form-label px-3 py-2 mb-0 d-flex align-items-center">
              <input
                className="me-2"
                type="checkbox"
                onChange={useCallback(
                  (e) => includeTrashPagesChangeHandler(e.target.checked),
                  [includeTrashPagesChangeHandler],
                )}
                checked={includeTrashPages}
              />
              {t('Include Subordinated Target Page', { target: '/trash' })}
            </label>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
};
