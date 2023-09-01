import React, { FC } from 'react';
import { useTranslation } from 'next-i18next';
import { SORT_AXIS, SORT_ORDER } from '../../interfaces/search';

const { DESC, ASC } = SORT_ORDER;

type Props = {
  sort: SORT_AXIS,
  order: SORT_ORDER,
  onChange?: (nextSort: SORT_AXIS, nextOrder: SORT_ORDER) => void,
}

const SortControl: FC <Props> = (props: Props) => {

  const { t } = useTranslation('');

  const { sort, order, onChange } = props;

  const onClickChangeSort = (nextSortAxis: SORT_AXIS, nextSortOrder: SORT_ORDER) => {
    if (onChange != null) {
      onChange(nextSortAxis, nextSortOrder);
    }
  };

  const renderOrderIcon = () => {
    const iconClassName = ASC === order ? 'fa fa-sort-amount-asc' : 'fa fa-sort-amount-desc';
    return <i className={iconClassName} aria-hidden="true" />;
  };

  return (
    <>
      <div className="input-group flex-nowrap">
        <div>
          <div className="input-group-text border text-muted" id="btnGroupAddon">
            {renderOrderIcon()}
          </div>
        </div>
        <div className="border rounded-end">
          <button
            type="button"
            className="btn dropdown-toggle py-1"
            data-bs-toggle="dropdown"
          >
            <span className="me-2 text-secondary">{t(`search_result.sort_axis.${sort}`)}</span>
          </button>
          <div className="dropdown-menu dropdown-menu-right">
            {Object.values(SORT_AXIS).map((sortAxis) => {
              const nextOrder = (sort !== sortAxis || order === ASC) ? DESC : ASC;
              return (
                <button
                  key={sortAxis}
                  className="dropdown-item"
                  type="button"
                  onClick={() => { onClickChangeSort(sortAxis, nextOrder) }}
                >
                  <span>{t(`search_result.sort_axis.${sortAxis}`)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </>
  );
};


export default SortControl;
