import type { FC } from 'react';
import React, {
  memo, useCallback, useMemo, type JSX,
} from 'react';

import { Pagination, PaginationItem, PaginationLink } from 'reactstrap';


type Props = {
  activePage: number,
  changePage?: (activePage: number) => void,
  totalItemsCount: number,
  pagingLimit?: number,
  align?: string,
  size?: string,
};


const PaginationWrapper: FC<Props> = memo((props: Props) => {
  const {
    activePage, changePage, totalItemsCount, pagingLimit, align,
  } = props;

  /**
   * various numbers used to generate pagination dom
   */
  const paginationNumbers = useMemo(() => {
    // avoid using null
    const limit = pagingLimit || Infinity;

    // calc totalPageNumber
    const totalPage = Math.floor(totalItemsCount / limit) + (totalItemsCount % limit === 0 ? 0 : 1);

    let paginationStart = activePage - 2;
    let maxViewPageNum = activePage + 2;
    // if pagiNation Number area size = 5 , pageNumber is calculated here
    // activePage Position calculate ex. 4 5 [6] 7 8 (Page8 over is Max), 3 4 5 [6] 7 (Page7 is Max)
    if (paginationStart < 1) {
      const diff = 1 - paginationStart;
      paginationStart += diff;
      maxViewPageNum = Math.min(totalPage, maxViewPageNum + diff);
    }
    if (maxViewPageNum > totalPage) {
      const diff = maxViewPageNum - totalPage;
      maxViewPageNum -= diff;
      paginationStart = Math.max(1, paginationStart - diff);
    }

    return {
      totalPage,
      paginationStart,
      maxViewPageNum,
    };
  }, [activePage, totalItemsCount, pagingLimit]);

  const { paginationStart } = paginationNumbers;
  const { maxViewPageNum } = paginationNumbers;
  const { totalPage } = paginationNumbers;

  /**
   * generate Elements of Pagination First Prev
   * ex.  <<   <   1  2  3  >  >>
   * this function set << & <
   */
  const generateFirstPrev = useCallback(() => {
    const paginationItems: JSX.Element[] = [];
    if (activePage !== 1) {
      paginationItems.push(
        <PaginationItem key="painationItemFirst">
          <PaginationLink first onClick={() => { return changePage != null && changePage(1) }} />
        </PaginationItem>,
        <PaginationItem key="painationItemPrevious">
          <PaginationLink previous onClick={() => { return changePage != null && changePage(activePage - 1) }} />
        </PaginationItem>,
      );
    }
    else {
      paginationItems.push(
        <PaginationItem key="painationItemFirst" disabled>
          <PaginationLink first />
        </PaginationItem>,
        <PaginationItem key="painationItemPrevious" disabled>
          <PaginationLink previous />
        </PaginationItem>,
      );
    }
    return paginationItems;
  }, [activePage, changePage]);

  /**
   * generate Elements of Pagination First Prev
   *  ex. << < 4 5 6 7 8 > >>, << < 1 2 3 4 > >>
   * this function set  numbers
   */
  const generatePaginations = useCallback(() => {
    const paginationItems: JSX.Element[] = [];
    for (let number = paginationStart; number <= maxViewPageNum; number++) {
      paginationItems.push(
        <PaginationItem key={`paginationItem-${number}`} active={number === activePage}>
          <PaginationLink onClick={() => { return changePage != null && changePage(number) }}>
            {number}
          </PaginationLink>
        </PaginationItem>,
      );
    }
    return paginationItems;
  }, [activePage, changePage, paginationStart, maxViewPageNum]);

  /**
   * generate Elements of Pagination First Prev
   * ex.  <<   <   1  2  3  >  >>
   * this function set > & >>
   */
  const generateNextLast = useCallback(() => {
    const paginationItems: JSX.Element[] = [];
    if (totalPage !== activePage) {
      paginationItems.push(
        <PaginationItem key="painationItemNext">
          <PaginationLink next onClick={() => { return changePage != null && changePage(activePage + 1) }} />
        </PaginationItem>,
        <PaginationItem key="painationItemLast">
          <PaginationLink last onClick={() => { return changePage != null && changePage(totalPage) }} />
        </PaginationItem>,
      );
    }
    else {
      paginationItems.push(
        <PaginationItem key="painationItemNext" disabled>
          <PaginationLink next />
        </PaginationItem>,
        <PaginationItem key="painationItemLast" disabled>
          <PaginationLink last />
        </PaginationItem>,
      );
    }
    return paginationItems;
  }, [activePage, changePage, totalPage]);

  const getListClassName = useMemo(() => {
    const listClassNames: string[] = [];

    if (align === 'center') {
      listClassNames.push('justify-content-center');
    }
    if (align === 'right') {
      listClassNames.push('justify-content-end');
    }

    return listClassNames.join(' ');
  }, [align]);

  return (
    <React.Fragment>
      <Pagination size={props.size} listClassName={getListClassName}>
        {generateFirstPrev()}
        {generatePaginations()}
        {generateNextLast()}
      </Pagination>
    </React.Fragment>
  );

});

PaginationWrapper.displayName = 'PaginationWrapper';

PaginationWrapper.defaultProps = {
  align: 'left',
  size: 'md',
  pagingLimit: Infinity,
};

export default PaginationWrapper;
