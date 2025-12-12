import { useTranslation } from 'react-i18next';
import SimpleBar from 'simplebar-react';

import type { SelectablePage } from '../../../../interfaces/selectable-page';
import { SelectablePageList } from './SelectablePageList';

type Props = {
  pages: SelectablePage[];
  onRemovePage: (page: SelectablePage) => void;
};

export const SelectedPagesPanel = (props: Props): JSX.Element => {
  const { pages, onRemovePage } = props;
  const { t } = useTranslation();

  return (
    <>
      <h4 className="text-center fw-bold mb-3 mt-4">
        {t('modal_ai_assistant.reference_pages')}
      </h4>

      <div className="px-4">
        <SimpleBar
          className="page-list-container"
          style={{ maxHeight: '300px' }}
        >
          <SelectablePageList
            method="remove"
            methodButtonPosition="right"
            pages={pages}
            onClickMethodButton={onRemovePage}
          />
        </SimpleBar>
        <span className="form-text text-muted mt-2">
          {t('modal_ai_assistant.can_add_later')}
        </span>
      </div>
    </>
  );
};
