import type { JSX } from 'react';

import { useLazyLoader } from '~/components/utils/use-lazy-loader';

type SearchOptionModalProps = {
  isOpen: boolean;
  includeUserPages: boolean;
  includeTrashPages: boolean;
  disableUserPages: boolean;
  onClose?: () => void;
  onIncludeUserPagesSwitched?: (isChecked: boolean) => void;
  onIncludeTrashPagesSwitched?: (isChecked: boolean) => void;
};

export const SearchOptionModalLazyLoaded = (
  props: SearchOptionModalProps,
): JSX.Element => {
  const { isOpen } = props;

  const SearchOptionModal = useLazyLoader<SearchOptionModalProps>(
    'search-option-modal',
    () =>
      import(
        '~/features/search/client/components/SearchPage/SearchOptionModal/SearchOptionModal'
      ).then((mod) => ({
        default: mod.SearchOptionModal,
      })),
    isOpen,
  );

  return SearchOptionModal ? <SearchOptionModal {...props} /> : <></>;
};
