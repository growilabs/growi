import React from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';
import { Modal, ModalBody, ModalFooter, ModalHeader } from 'reactstrap';

import BootstrapGrid from '~/client/models/BootstrapGrid';

import geu from './GridEditorUtil';

import styles from './GridEditModal.module.scss';

const resSizes = BootstrapGrid.ResponsiveSize;
const resSizeObj = {
  [resSizes.XS_SIZE]: { displayText: 'grid_edit.smart_no' },
  [resSizes.SM_SIZE]: { displayText: 'tablet' },
  [resSizes.MD_SIZE]: { displayText: 'desktop' },
};
class GridEditModal extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      colsRatios: [6, 6],
      responsiveSize: BootstrapGrid.ResponsiveSize.XS_SIZE,
      show: false,
      // use when re-edit grid
      // gridHtml: '',
    };

    this.checkResposiveSize = this.checkResposiveSize.bind(this);
    this.checkColsRatios = this.checkColsRatios.bind(this);
    // use when re-edit grid
    // this.init = this.init.bind(this);
    this.show = this.show.bind(this);
    this.hide = this.hide.bind(this);
    this.cancel = this.cancel.bind(this);
    this.pasteCodedGrid = this.pasteCodedGrid.bind(this);
    this.renderSelectedGridPattern = this.renderSelectedGridPattern.bind(this);
    this.renderBreakPointSetting = this.renderBreakPointSetting.bind(this);
  }

  async checkResposiveSize(rs) {
    await this.setState({ responsiveSize: rs });
  }

  async checkColsRatios(cr) {
    await this.setState({ colsRatios: cr });
  }

  // use when re-edit grid
  // init(gridHtml) {
  //   const initGridHtml = gridHtml;
  //   this.setState({ gridHtml: initGridHtml });
  // }

  show(gridHtml) {
    // use when re-edit grid
    // this.init(gridHtml);
    this.setState({ show: true });
  }

  hide() {
    this.setState({ show: false });
  }

  cancel() {
    this.hide();
  }

  pasteCodedGrid() {
    const { colsRatios, responsiveSize } = this.state;
    const convertedHTML = geu.convertRatiosAndSizeToHTML(
      colsRatios,
      responsiveSize,
    );
    const spaceTab = '    ';
    const pastedGridData = `::: editable-row\n<div class="container">\n${spaceTab}<div class="row">\n${convertedHTML}\n${spaceTab}</div>\n</div>\n:::`;

    if (this.props.onSave != null) {
      this.props.onSave(pastedGridData);
    }
    this.cancel();
  }

  renderSelectedGridPattern() {
    const colsRatios = this.state.colsRatios;
    return colsRatios.join(' - ');
  }

  renderBreakPointSetting() {
    const { t } = this.props;
    const output = Object.entries(resSizeObj).map((responsiveSizeForMap) => {
      return (
        <div
          key={responsiveSizeForMap[0]}
          className="form-check form-check-inline"
        >
          <input
            type="radio"
            className="form-check-input"
            id={responsiveSizeForMap[1].displayText}
            value={responsiveSizeForMap[1].displayText}
            checked={this.state.responsiveSize === responsiveSizeForMap[0]}
            onChange={(e) => this.checkResposiveSize(responsiveSizeForMap[0])}
          />
          <label
            className="form-label form-check-label"
            htmlFor={responsiveSizeForMap[1].displayText}
          >
            {t(responsiveSizeForMap[1].displayText)}
          </label>
        </div>
      );
    });
    return output;
  }

  renderGridDivisionMenu() {
    const gridDivisions = geu.mappingAllGridDivisionPatterns;
    const { t } = this.props;
    return (
      <div className="container">
        <div className="row">
          {gridDivisions.map((gridDivision) => {
            const numOfDivisions = gridDivision.numberOfGridDivisions;
            return (
              <div
                key={`${numOfDivisions}-divisions`}
                className="col-md-4 text-center"
              >
                <h6 className="dropdown-header">
                  {numOfDivisions} {t('grid_edit.division')}
                </h6>
                {gridDivision.mapping.map((gridOneDivision) => {
                  const keyOfRow = `${numOfDivisions}-divisions-${gridOneDivision.join('-')}`;
                  return (
                    <button
                      key={keyOfRow}
                      className="dropdown-item"
                      type="button"
                      onClick={() => {
                        this.checkColsRatios(gridOneDivision);
                      }}
                    >
                      <div className="row">
                        {gridOneDivision.map((god, i) => {
                          const keyOfCol = `${keyOfRow}-${i}`;
                          const className = `bg-info col-${god} border`;
                          return (
                            <span key={keyOfCol} className={className}>
                              {god}
                            </span>
                          );
                        })}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  renderPreview() {
    const { t } = this.props;
    const isMdSelected =
      this.state.responsiveSize === BootstrapGrid.ResponsiveSize.MD_SIZE;
    const isXsSelected =
      this.state.responsiveSize === BootstrapGrid.ResponsiveSize.XS_SIZE;
    return (
      <div className="row grw-grid-edit-preview border my-4 p-3">
        <div className="col-lg-2">
          <h4 className="d-block mt-2">{t('phone')}</h4>
          <div className="mobile-preview d-block px-3 py-2">
            {this.renderGridPreview(!isXsSelected)}
          </div>
        </div>
        <div className="col-lg-3">
          <h4 className="d-block mt-2">{t('tablet')}</h4>
          <div className="tablet-preview d-block px-3 py-2">
            {this.renderGridPreview(isMdSelected)}
          </div>
        </div>
        <div className="col-lg-4">
          <h4 className="d-block mt-2">{t('desktop')}</h4>
          <div className="desktop-preview d-block px-3 py-2">
            {this.renderGridPreview(false)}
          </div>
        </div>
      </div>
    );
  }

  renderGridPreview(isBreakEnabled) {
    const { colsRatios } = this.state;

    const convertedHTML = colsRatios.map((colsRatio, i) => {
      const ratio = isBreakEnabled ? 12 : colsRatio;
      const key = `grid-preview-col-${i}`;
      const className = `col-${ratio} grid-edit-border-for-each-cols`;
      return <div key={key} className={`${key} ${className}`}></div>;
    });
    return <div className="row">{convertedHTML}</div>;
  }

  render() {
    const { t } = this.props;
    return (
      <Modal
        isOpen={this.state.show}
        toggle={this.cancel}
        size="xl"
        className={`grw-grid-edit-modal ${styles['grw-grid-edit-modal']}`}
      >
        <ModalHeader tag="h4" toggle={this.cancel}>
          {t('grid_edit.create_bootstrap_4_grid')}
        </ModalHeader>
        <ModalBody className="container">
          <div className="row">
            <div className="col-12">
              <h3 className="grw-modal-head">{t('grid_edit.grid_settings')}</h3>
              <form className="mb-0">
                <div className="row my-3">
                  <label className="form-label col-sm-3" htmlFor="gridPattern">
                    {t('grid_edit.grid_pattern')}
                  </label>
                  <div className="col-sm-9">
                    <button
                      className="btn btn-outline-secondary dropdown-toggle"
                      type="button"
                      id="dropdownMenuButton"
                      data-bs-toggle="dropdown"
                      aria-haspopup="true"
                      aria-expanded="false"
                    >
                      {this.renderSelectedGridPattern()}
                    </button>
                    <div
                      className="dropdown-menu grid-division-menu"
                      role="menu"
                      aria-labelledby="dropdownMenuButton"
                    >
                      {this.renderGridDivisionMenu()}
                    </div>
                  </div>
                </div>
                <div className="row">
                  <label className="form-label col-sm-3" htmlFor="breakPoint">
                    {t('grid_edit.break_point')}
                  </label>
                  <div className="col-sm-9">
                    {this.renderBreakPointSetting()}
                  </div>
                </div>
              </form>
            </div>
          </div>
          <h3 className="grw-modal-head">{t('preview')}</h3>
          <div className="col-12">{this.renderPreview()}</div>
        </ModalBody>
        <ModalFooter className="grw-modal-footer">
          <div className="ms-auto">
            <button
              type="button"
              className="me-2 btn btn-secondary"
              onClick={this.cancel}
            >
              Cancel
            </button>
            <button
              type="button"
              className="btn btn-primary"
              onClick={this.pasteCodedGrid}
            >
              Done
            </button>
          </div>
        </ModalFooter>
      </Modal>
    );
  }
}

const GridEditModalFc = React.forwardRef((props, ref) => {
  const { t } = useTranslation();
  return <GridEditModal t={t} ref={ref} {...props} />;
});

GridEditModal.propTypes = {
  onSave: PropTypes.func,
  t: PropTypes.func.isRequired,
};
export default GridEditModalFc;
