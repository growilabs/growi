import React, { type JSX, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ModalBody } from 'reactstrap';
import SimpleBar from 'simplebar-react';

import { useLimitLearnablePageCountPerAssistant } from '~/stores-universal/context';

import type { SelectablePage } from '../../../../interfaces/selectable-page';
import { AiAssistantManagementHeader } from './AiAssistantManagementHeader';
import { PageSelectionMethodButtons } from './PageSelectionMethodButtons';
import { SelectablePageList } from './SelectablePageList';

type Props = {
  selectedPages: SelectablePage[];
  onRemove: (pageId: string) => void;
};

export const AiAssistantManagementEditPages = (props: Props): JSX.Element => {
  const { t } = useTranslation();
  const { data: limitLearnablePageCountPerAssistant } =
    useLimitLearnablePageCountPerAssistant();

  const { selectedPages, onRemove } = props;

  const removePageHandler = useCallback(
    (page: SelectablePage) => {
      onRemove(page.path);
    },
    [onRemove],
  );

  return (
    <>
      <AiAssistantManagementHeader labelTranslationKey="modal_ai_assistant.page_mode_title.pages" />

      <ModalBody className="px-4">
        <div className="px-4">
          <p
            className="text-secondary"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: ignore
            dangerouslySetInnerHTML={{
              __html: t('modal_ai_assistant.edit_page_description', {
                limitLearnablePageCountPerAssistant,
              }),
            }}
          />

          <div className="mb-3">
            <PageSelectionMethodButtons />
          </div>

          <SimpleBar style={{ maxHeight: '300px' }}>
            <SelectablePageList
              isEditable
              method="delete"
              methodButtonPosition="right"
              pages={selectedPages}
              onClickMethodButton={removePageHandler}
            />
          </SimpleBar>
        </div>
      </ModalBody>
    </>
  );
};
