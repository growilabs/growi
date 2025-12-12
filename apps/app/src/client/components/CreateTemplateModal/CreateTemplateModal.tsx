import React, { useCallback, useMemo } from 'react';

import { pathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import { Modal, ModalHeader, ModalBody } from 'reactstrap';

import { useCreateTemplatePage } from '~/client/services/create-page';
import { toastError } from '~/client/util/toastr';
import type { TargetType, LabelType } from '~/interfaces/template';


type TemplateCardProps = {
  target: TargetType;
  label: LabelType;
  isPageCreating: boolean;
  onClickHandler: () => void;
};

const TemplateCard: React.FC<TemplateCardProps> = ({
  target, label, isPageCreating, onClickHandler,
}) => {
  const { t } = useTranslation();

  return (
    <div className="card card-select-template">
      <div className="card-header">{t(`template.${target}.label`)}</div>
      <div className="card-body">
        <p className="text-center"><code>{label}</code></p>
        <p className="form-text text-muted text-center"><small>{t(`template.${target}.desc`)}</small></p>
      </div>
      <div className="card-footer text-center">
        <button
          disabled={isPageCreating}
          data-testid={`template-button-${target}`}
          className="btn btn-sm btn-primary"
          id={`template-button-${target}`}
          onClick={onClickHandler}
          type="button"
        >
          {t('Edit')}
        </button>
      </div>
    </div>
  );
};

type CreateTemplateModalProps = {
  path: string;
  isOpen: boolean;
  onClose: () => void;
};

export const CreateTemplateModal: React.FC<CreateTemplateModalProps> = ({
  path, isOpen, onClose,
}) => {
  const { t } = useTranslation(['translation', 'commons']);

  const { createTemplate, isCreating, isCreatable } = useCreateTemplatePage();

  const onClickTemplateButtonHandler = useCallback(async(label: LabelType) => {
    try {
      await createTemplate?.(label);
      onClose();
    }
    catch (err) {
      toastError(t('toaster.create_failed', { target: path }));
    }
  }, [createTemplate, onClose, path, t]);

  // Memoize computed path
  const parentPath = useMemo(() => pathUtils.addTrailingSlash(path), [path]);

  // Memoize template card rendering function
  const renderTemplateCard = useCallback((target: TargetType, label: LabelType) => (
    <div className="col">
      <TemplateCard
        target={target}
        label={label}
        isPageCreating={isCreating}
        onClickHandler={() => onClickTemplateButtonHandler(label)}
      />
    </div>
  ), [isCreating, onClickTemplateButtonHandler]);

  return (
    <Modal isOpen={isOpen} toggle={onClose} data-testid="page-template-modal">
      {(isCreatable && isOpen) && (
        <>
          <ModalHeader tag="h4" toggle={onClose}>
            {t('template.modal_label.Create/Edit Template Page')}
          </ModalHeader>
          <ModalBody>
            <div>
              <label className="form-label mb-4">
                <code>{parentPath}</code><br />
                {t('template.modal_label.Create template under')}
              </label>
              <div className="row row-cols-2">
                {renderTemplateCard('children', '_template')}
                {renderTemplateCard('descendants', '__template')}
              </div>
            </div>
          </ModalBody>
        </>
      )}
    </Modal>
  );
};
