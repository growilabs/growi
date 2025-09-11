import type { JSX } from 'react';

import { useTranslation } from 'react-i18next';
import {
  ModalBody,
  Input,
  UncontrolledDropdown,
  DropdownToggle,
  DropdownMenu,
  DropdownItem,
} from 'reactstrap';

import { useAiAssistantManagementModal, AiAssistantManagementModalPageMode } from '../../../stores/ai-assistant';

import { AiAssistantManagementHeader } from './AiAssistantManagementHeader';


type Props = {
  instruction: string;
  onChange: (value: string) => void;
  onReset: () => void;
}

export const AiAssistantManagementEditInstruction = (props: Props): JSX.Element => {
  const { instruction, onChange, onReset } = props;
  const { t } = useTranslation();
  const { changePageMode } = useAiAssistantManagementModal();

  const handleComplete = () => {
    changePageMode(AiAssistantManagementModalPageMode.HOME);
  };

  return (
    <>
      <AiAssistantManagementHeader labelTranslationKey="modal_ai_assistant.page_mode_title.instruction" />

      <ModalBody className="p-4">
        <p
          className="text-secondary py-1"
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: t('modal_ai_assistant.instructions.description') }}
        />

        <Input
          autoFocus
          type="textarea"
          className="mb-4"
          rows="8"
          value={instruction}
          onChange={e => onChange(e.target.value)}
        />

        <div className="d-flex justify-content-end align-items-center">
          <UncontrolledDropdown>
            <DropdownToggle
              className="btn btn-outline-neutral-secondary text-secondary p-2"
              tag="button"
              type="button"
            >
              <span className="material-symbols-outlined">more_horiz</span>
            </DropdownToggle>
            <DropdownMenu end>
              <DropdownItem onClick={onReset}>
                <span className="material-symbols-outlined me-2 align-middle">undo</span>
                {t('modal_ai_assistant.instructions.reset_to_default')}
              </DropdownItem>
            </DropdownMenu>
          </UncontrolledDropdown>

          <button
            type="button"
            onClick={handleComplete}
            className="btn btn-primary ms-3"
          >
            {t('Done')}
          </button>
        </div>
      </ModalBody>
    </>
  );
};
