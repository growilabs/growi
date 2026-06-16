import React, { type JSX, useCallback } from 'react';
import { useAtomValue } from 'jotai';
import { useTranslation } from 'react-i18next';
import { ModalBody } from 'reactstrap';
import SimpleBar from 'simplebar-react';

import { AiAssistantManagementHeader } from '~/features/openai/client/components/AiAssistant/AiAssistantManagementModal/AiAssistantManagementHeader';
import { PageSelectionMethodButtons } from '~/features/openai/client/components/AiAssistant/AiAssistantManagementModal/PageSelectionMethodButtons';
import { SelectablePageList } from '~/features/openai/client/components/AiAssistant/AiAssistantManagementModal/SelectablePageList';
import { limitLearnablePageCountPerAssistantAtom } from '~/states/server-configurations';

import type { SelectablePage } from '../../../../interfaces/selectable-page';

type Props = {
  selectedPages: SelectablePage[];
  onRemove: (pageId: string) => void;
};

export const AiAssistantManagementEditPages = (props: Props): JSX.Element => {
  const { t } = useTranslation();
  const limitLearnablePageCountPerAssistant = useAtomValue(
    limitLearnablePageCountPerAssistantAtom,
  );

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
