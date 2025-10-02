import type { JSX } from 'react';

import { useTranslation } from 'react-i18next';
import { ModalBody, Input } from 'reactstrap';

import { AiAssistantManagementHeader } from './AiAssistantManagementHeader';


type Props = {
  instruction: string;
  onChange: (value: string) => void;
  onReset: () => void;
}

export const AiAssistantManagementEditInstruction = (props: Props): JSX.Element => {
  const { instruction, onChange, onReset } = props;
  const { t } = useTranslation();

  return (
    <>
      <AiAssistantManagementHeader labelTranslationKey="modal_ai_assistant.page_mode_title.instruction" />

      <ModalBody className="px-4">
        <p className="text-secondary py-1">
          {t('modal_ai_assistant.instructions.description')}
        </p>

        <Input
          autoFocus
          type="textarea"
          className="mb-3"
          rows="8"
          value={instruction}
          onChange={e => onChange(e.target.value)}
        />

        <button type="button" onClick={onReset} className="btn btn-outline-secondary btn-sm">
          {t('modal_ai_assistant.instructions.reset_to_default')}
        </button>
      </ModalBody>
    </>
  );
};
