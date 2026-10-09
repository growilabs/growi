import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';

import type { SearchFilterState } from '../../../utils/search-query';

type SearchOptionModalProps = {
  isOpen: boolean;
  includeUserPages: boolean;
  includeTrashPages: boolean;
  disableUserPages: boolean;
  isEnableFilter?: boolean;
  filters?: SearchFilterState;
  onClose?: () => void;
  onIncludeUserPagesSwitched?: (isChecked: boolean) => void;
  onIncludeTrashPagesSwitched?: (isChecked: boolean) => void;
  onFiltersChange?: (filters: SearchFilterState) => void;
};

export const SearchOptionModalLazyLoaded = (
  props: SearchOptionModalProps,
): JSX.Element => {
  const { isOpen } = props;

  const SearchOptionModal = useLazyLoader<SearchOptionModalProps>(
    'search-option-modal',
    () =>
      import('./SearchOptionModal').then((mod) => ({
        default: mod.SearchOptionModal,
      })),
    isOpen,
  );

  return SearchOptionModal ? <SearchOptionModal {...props} /> : <></>;
};
