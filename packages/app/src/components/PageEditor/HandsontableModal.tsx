import React, { useState, useEffect } from 'react';

import { HotTable } from '@handsontable/react';
import Handsontable from 'handsontable';
import { useTranslation } from 'next-i18next';
import {
  Collapse,
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';
import { debounce } from 'throttle-debounce';

import MarkdownTable from '~/client/models/MarkdownTable';
import mtu from '~/components/PageEditor/MarkdownTableUtil';
import { useHandsontableModal } from '~/stores/modal';

import ExpandOrContractButton from '../ExpandOrContractButton';

import { MarkdownTableDataImportForm } from './MarkdownTableDataImportForm';

import styles from './HandsontableModal.module.scss';
import 'handsontable/dist/handsontable.full.min.css';

const DEFAULT_HOT_HEIGHT = 300;
const MARKDOWNTABLE_TO_HANDSONTABLE_ALIGNMENT_SYMBOL_MAPPING = {
  r: 'htRight',
  c: 'htCenter',
  l: 'htLeft',
  '': '',
};

export const HandsontableModal = (): JSX.Element => {

  const { t } = useTranslation('commons');
  const { data: handsontableModalData, close: closeHandsontableModal } = useHandsontableModal();
  const isOpened = handsontableModalData?.isOpened ?? false;
  const table = handsontableModalData?.table;
  const autoFormatMarkdownTable = handsontableModalData?.autoFormatMarkdownTable ?? false;
  const editor = handsontableModalData?.editor;

  const defaultMarkdownTable = () => {
    return new MarkdownTable(
      [
        ['col1', 'col2', 'col3'],
        ['', '', ''],
        ['', '', ''],
      ],
      {
        align: ['', '', ''],
      },
    );
  };

  const defaultHandsontableSetting = () => {
    return {
      rowHeaders: true,
      colHeaders: true,
      manualRowMove: true,
      manualRowResize: true,
      manualColumnMove: true,
      manualColumnResize: true,
      selectionMode: 'multiple',
      outsideClickDeselects: false,
    };
  };

  // A Set instance that stores column indices which are resized manually.
  // these columns will NOT be determined the width automatically by 'modifyColWidthHandler'
  const manuallyResizedColumnIndicesSet = new Set();

  /*
   * ## Note ##
   * Currently, this component try to synchronize the cells data and alignment data of state.markdownTable with these of the HotTable.
   * However, changes made by the following operations are not synchronized.
   *
   * 1. move columns: Alignment changes are synchronized but data changes are not.
   * 2. move rows: Data changes are not synchronized.
   * 3. insert columns or rows: Data changes are synchronized but alignment changes are not.
   * 4. delete columns or rows: Data changes are synchronized but alignment changes are not.
   *
   * However, all operations are reflected in the data to be saved because the HotTable data is used when the save method is called.
   */
  const [hotTable, setHotTable] = useState<HotTable | null>();
  const [hotTableContainer, setHotTableContainer] = useState<HTMLDivElement | null>();
  const [isDataImportAreaExpanded, setIsDataImportAreaExpanded] = useState<boolean>(false);
  const [isWindowExpanded, setIsWindowExpanded] = useState<boolean>(false);
  const [markdownTable, setMarkdownTable] = useState<MarkdownTable>(defaultMarkdownTable);
  const [markdownTableOnInit, setMarkdownTableOnInit] = useState<MarkdownTable>(defaultMarkdownTable);
  const [handsontableHeight, setHandsontableHeight] = useState<number>(DEFAULT_HOT_HEIGHT);

  useEffect(() => {
    const initTableInstance = table == null ? defaultMarkdownTable : table.clone();
    setMarkdownTable(table ?? defaultMarkdownTable);
    setMarkdownTableOnInit(initTableInstance);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpened]);

  const markdownTableOption = {
    get latest() {
      return {
        align: [].concat(markdownTable.options.align),
        pad: autoFormatMarkdownTable !== false,
      };
    },
  };

  /**
   * Reset table data to initial value
   *
   * ## Note ##
   * It may not return completely to the initial state because of the manualColumnMove operations.
   * https://github.com/handsontable/handsontable/issues/5591
   */
  const reset = () => {
    setMarkdownTable(markdownTableOnInit.clone());
  };

  const cancel = () => {
    closeHandsontableModal();
    setIsDataImportAreaExpanded(false);
    setIsWindowExpanded(false);
  };

  const save = () => {
    if (hotTable == null || editor == null) {
      return;
    }

    const newMarkdownTable = new MarkdownTable(
      hotTable.hotInstance.getData(),
      markdownTableOption.latest,
    ).normalizeCells();

    mtu.replaceFocusedMarkdownTableWithEditor(editor, newMarkdownTable);

    cancel();
  };

  const beforeColumnResizeHandler = (currentColumn) => {
    /*
     * The following bug disturbs to use 'beforeColumnResizeHandler' to store column index -- 2018.10.23 Yuki Takei
     * https://github.com/handsontable/handsontable/issues/3328
     *
     * At the moment, using 'afterColumnResizeHandler' instead.
     */

    // store column index
    // this.manuallyResizedColumnIndicesSet.add(currentColumn);
  };

  const afterColumnResizeHandler = (currentColumn) => {
    if (hotTable == null) {
      return;
    }

    /*
     * The following bug disturbs to use 'beforeColumnResizeHandler' to store column index -- 2018.10.23 Yuki Takei
     * https://github.com/handsontable/handsontable/issues/3328
     *
     * At the moment, using 'afterColumnResizeHandler' instead.
     */

    // store column index
    manuallyResizedColumnIndicesSet.add(currentColumn);
    // force re-render
    const hotInstance = hotTable.hotInstance;
    hotInstance.render();
  };

  const modifyColWidthHandler = (width, column) => {
    // return original width if the column index exists in 'manuallyResizedColumnIndicesSet'
    if (manuallyResizedColumnIndicesSet.has(column)) {
      return width;
    }
    // return fixed width if first initializing
    return Math.max(80, Math.min(400, width));
  };

  const beforeColumnMoveHandler = (columns, target) => {
    // clear 'manuallyResizedColumnIndicesSet'
    manuallyResizedColumnIndicesSet.clear();
  };

  /**
   * synchronize the handsontable alignment to the markdowntable alignment
   */
  const synchronizeAlignment = () => {
    if (hotTable == null) {
      return;
    }

    const align = markdownTable.options.align;
    const hotInstance = hotTable.hotInstance;

    if (hotInstance.isDestroyed === true || align == null) {
      return;
    }

    for (let i = 0; i < align.length; i++) {
      for (let j = 0; j < hotInstance.countRows(); j++) {
        hotInstance.setCellMeta(j, i, 'className', MARKDOWNTABLE_TO_HANDSONTABLE_ALIGNMENT_SYMBOL_MAPPING[align[i]]);
      }
    }
    hotInstance.render();
  };

  /**
   * An afterLoadData hook
   *
   * This performs the following operations.
   * - clear 'manuallyResizedColumnIndicesSet' for the first loading
   * - synchronize the handsontable alignment to the markdowntable alignment
   *
   * ## Note ##
   * The afterLoadData hook is called when one of the following states of this component are passed into the setState.
   *
   * - markdownTable
   * - handsontableHeight
   *
   * In detail, when the setState method is called with those state passed,
   * React will start re-render process for the HotTable of this component because the HotTable receives those state values by props.
   * HotTable#shouldComponentUpdate is called in this re-render process and calls the updateSettings method for the Handsontable instance.
   * In updateSettings method, the loadData method is called in some case.
   *  (refs: https://github.com/handsontable/handsontable/blob/6.2.0/src/core.js#L1652-L1657)
   * The updateSettings method calls in the HotTable always lead to call the loadData method because the HotTable passes data source by settings.data.
   * After the loadData method is executed, afterLoadData hooks are called.
   */
  const afterLoadDataHandler = (initialLoad: boolean) => {
    if (initialLoad) {
      manuallyResizedColumnIndicesSet.clear();
    }

    synchronizeAlignment();
  };

  /**
   * An afterColumnMove hook.
   *
   * This synchronizes alignment when columns are moved by manualColumnMove
   */
  // TODO: colums type is number[]
  const afterColumnMoveHandler = (columns: any, target: number) => {
    const align = [].concat(markdownTable.options.align);
    const removed = align.splice(columns[0], columns.length);

    /*
      * The following is a description of the algorithm for the alignment synchronization.
      *
      * Consider the case where the target is X and the columns are [2,3] and data is as follows.
      *
      * 0 1 2 3 4 5 (insert position number)
      * +-+-+-+-+-+
      * | | | | | |
      * +-+-+-+-+-+
      *  0 1 2 3 4  (column index number)
      *
      * At first, remove columns by the splice.
      *
      * 0 1 2   4 5
      * +-+-+   +-+
      * | | |   | |
      * +-+-+   +-+
      *  0 1     4
      *
      * Next, insert those columns into a new position.
      * However the target number is a insert position number before deletion, it may be changed.
      * These are changed as follows.
      *
      * Before:
      * 0 1 2   4 5
      * +-+-+   +-+
      * | | |   | |
      * +-+-+   +-+
      *
      * After:
      * 0 1 2   2 3
      * +-+-+   +-+
      * | | |   | |
      * +-+-+   +-+
      *
      * If X is 0, 1 or 2, that is, lower than columns[0], the target number is not changed.
      * If X is 4 or 5, that is, higher than columns[columns.length - 1], the target number is modified to the original value minus columns.length.
      *
      */
    let insertPosition = 0;
    if (target <= columns[0]) {
      insertPosition = target;
    }
    else if (columns[columns.length - 1] < target) {
      insertPosition = target - columns.length;
    }

    for (let i = 0; i < removed.length; i++) {
      align.splice(insertPosition + i, 0, removed[i]);
    }

    setMarkdownTable((prevMarkdownTable) => {
      // change only align info, so share table data to avoid redundant copy
      const newMarkdownTable = new MarkdownTable(prevMarkdownTable.table, { align });
      return newMarkdownTable;
    });

    synchronizeAlignment();
  };

  /**
   * change the markdownTable alignment and synchronize the handsontable alignment to it
   */
  const align = (direction: string, startCol: number, endCol: number) => {
    setMarkdownTable((prevMarkdownTable) => {
      // change only align info, so share table data to avoid redundant copy
      const newMarkdownTable = new MarkdownTable(prevMarkdownTable.table, { align: [].concat(prevMarkdownTable.options.align) });
      for (let i = startCol; i <= endCol; i++) {
        newMarkdownTable.options.align[i] = direction;
      }
      return newMarkdownTable;
    });

    synchronizeAlignment();
  };

  const alignButtonHandler = (direction: string) => {
    if (hotTable == null) {
      return;
    }

    const selectedRange = hotTable.hotInstance.getSelectedRange();
    if (selectedRange == null) return;

    const startCol = selectedRange[0].from.col < selectedRange[0].to.col ? selectedRange[0].from.col : selectedRange[0].to.col;
    const endCol = selectedRange[0].from.col < selectedRange[0].to.col ? selectedRange[0].to.col : selectedRange[0].from.col;

    align(direction, startCol, endCol);
  };

  const toggleDataImportArea = () => {
    setIsDataImportAreaExpanded(!isDataImportAreaExpanded);
  };

  const init = (markdownTable: MarkdownTable) => {
    const initMarkdownTable = markdownTable || defaultMarkdownTable;
    setMarkdownTableOnInit(initMarkdownTable);
    setMarkdownTable(initMarkdownTable.clone());
    manuallyResizedColumnIndicesSet.clear();
  };

  /**
   * Import a markdowntable
   *
   * ## Note ##
   * The manualColumnMove operation affects the column order of imported data.
   * https://github.com/handsontable/handsontable/issues/5591
   */
  const importData = (markdownTable: MarkdownTable) => {
    init(markdownTable);
    toggleDataImportArea();
  };

  /**
   * Expand the height of the Handsontable
   *  by updating 'handsontableHeight' state
   *  according to the height of this.refs.hotTableContainer
   */
  const expandHotTableHeight = () => {
    if (isWindowExpanded && hotTableContainer != null) {
      const height = hotTableContainer.getBoundingClientRect().height;
      setHandsontableHeight(height);
    }
  };

  const expandWindow = () => {
    setIsWindowExpanded(true);

    // create debounced method for expanding HotTable
    // invoke updateHotTableHeight method with delay
    // cz. Resizing this.refs.hotTableContainer is completed after a little delay after 'isWindowExpanded' set with 'true'
    debounce(100, expandHotTableHeight);
  };

  const contractWindow = () => {
    setIsWindowExpanded(false);
    setHandsontableHeight(DEFAULT_HOT_HEIGHT);
  };

  const createCustomizedContextMenu = () => {
    return {
      items: {
        row_above: {},
        row_below: {},
        col_left: {},
        col_right: {},
        separator1: '---------',
        remove_row: {},
        remove_col: {},
        separator2: '---------',
        custom_alignment: {
          name: 'Align columns',
          key: 'align_columns',
          submenu: {
            items: [
              {
                name: 'Left',
                key: 'align_columns:1',
                callback: (key, selection) => { align('l', selection[0].start.col, selection[0].end.col) },
              }, {
                name: 'Center',
                key: 'align_columns:2',
                callback: (key, selection) => { align('c', selection[0].start.col, selection[0].end.col) },
              }, {
                name: 'Right',
                key: 'align_columns:3',
                callback: (key, selection) => { align('r', selection[0].start.col, selection[0].end.col) },
              },
            ],
          },
        },
      },
    };
  };

  // generate setting object for HotTable instance
  const handsontableSettings = Object.assign(defaultHandsontableSetting(), {
    contextMenu: createCustomizedContextMenu(),
  });

  const closeButton = (
    <span>
      {/* change order because of `float: right` by '.close' class */}
      <button type="button" className="close" onClick={cancel} aria-label="Close">
        <span aria-hidden="true">&times;</span>
      </button>
      <ExpandOrContractButton
        isWindowExpanded={isWindowExpanded}
        contractWindow={contractWindow}
        expandWindow={expandWindow}
      />
    </span>
  );

  return (
    <Modal
      isOpen={isOpened}
      toggle={cancel}
      backdrop="static"
      keyboard={false}
      size="lg"
      wrapClassName={`${styles['grw-handsontable']}`}
      className={`handsontable-modal ${isWindowExpanded && 'grw-modal-expanded'}`}
    >
      <ModalHeader tag="h4" toggle={cancel} close={closeButton} className="bg-primary text-light">
        {t('handsontable_modal.title')}
      </ModalHeader>
      <ModalBody className="p-0 d-flex flex-column">
        <div className="grw-hot-modal-navbar px-4 py-3 border-bottom">
          <button
            type="button"
            className="mr-4 data-import-button btn btn-secondary"
            data-toggle="collapse"
            data-target="#collapseDataImport"
            aria-expanded={isDataImportAreaExpanded}
            onClick={toggleDataImportArea}
          >
            <span className="mr-3">{t('handsontable_modal.data_import')}</span>
            <i className={isDataImportAreaExpanded ? 'fa fa-angle-up' : 'fa fa-angle-down'}></i>
          </button>
          <div role="group" className="btn-group">
            <button type="button" className="btn btn-secondary" onClick={() => { alignButtonHandler('l') }}>
              <i className="ti ti-align-left"></i>
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => { alignButtonHandler('c') }}>
              <i className="ti ti-align-center"></i>
            </button>
            <button type="button" className="btn btn-secondary" onClick={() => { alignButtonHandler('r') }}>
              <i className="ti ti-align-right"></i>
            </button>
          </div>
          <Collapse isOpen={isDataImportAreaExpanded}>
            <div className="mt-4">
              <MarkdownTableDataImportForm onCancel={toggleDataImportArea} onImport={importData} />
            </div>
          </Collapse>
        </div>
        <div ref={c => setHotTableContainer(c)} className="m-4 hot-table-container">
          <HotTable
            ref={c => setHotTable(c)}
            data={markdownTable.table}
            settings={handsontableSettings as Handsontable.DefaultSettings}
            height={handsontableHeight}
            afterLoadData={afterLoadDataHandler}
            modifyColWidth={modifyColWidthHandler}
            beforeColumnMove={beforeColumnMoveHandler}
            beforeColumnResize={beforeColumnResizeHandler}
            afterColumnResize={afterColumnResizeHandler}
            afterColumnMove={afterColumnMoveHandler}
          />
        </div>
      </ModalBody>
      <ModalFooter className="grw-modal-footer">
        <button type="button" className="btn btn-danger" onClick={reset}>{t('commons:Reset')}</button>
        <div className="ml-auto">
          <button type="button" className="mr-2 btn btn-secondary" onClick={cancel}>{t('handsontable_modal.cancel')}</button>
          <button type="button" className="btn btn-primary" onClick={save}>{t('handsontable_modal.done')}</button>
        </div>
      </ModalFooter>
    </Modal>
  );
};
