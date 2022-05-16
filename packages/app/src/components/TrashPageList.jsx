import React, { useMemo } from 'react';

import PropTypes from 'prop-types';
import { withTranslation } from 'react-i18next';

import CustomNavAndContents from './CustomNavigation/CustomNavAndContents';
import { DescendantsPageListForCurrentPath } from './DescendantsPageList';
import EmptyTrashButton from './EmptyTrashButton';
import PageListIcon from './Icons/PageListIcon';


const TrashPageList = (props) => {
  const { t } = props;

  const navTabMapping = useMemo(() => {
    return {
      pagelist: {
        Icon: PageListIcon,
        Content: DescendantsPageListForCurrentPath,
        i18n: t('page_list'),
        index: 0,
      },
    };
  }, [t]);

  const emptyTrashButton = useMemo(() => {
    return <EmptyTrashButton />;
  }, [t]);

  return (
    <div data-testid="trash-page-list" className="mt-5 d-edit-none">
      <CustomNavAndContents navTabMapping={navTabMapping} navRightElement={emptyTrashButton} />
    </div>
  );
};

TrashPageList.propTypes = {
  t: PropTypes.func.isRequired, //  i18next
};

export default withTranslation()(TrashPageList);
