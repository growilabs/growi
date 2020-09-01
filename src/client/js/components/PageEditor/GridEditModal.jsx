import React from 'react';
import PropTypes from 'prop-types';
import {
  Modal, ModalHeader, ModalBody, ModalFooter,
} from 'reactstrap';
import geu from './GridEditorUtil';
import BootstrapGrid from '../../models/BootstrapGrid';

const resSizes = BootstrapGrid.ResponsiveSize;
const resSizeObj = {
  [resSizes.XS_SIZE]: { iconClass: 'icon-screen-smartphone', prevClass: 'desktop-preview', displayText: 'Smartphone / No Break' },
  [resSizes.SM_SIZE]: { iconClass: 'icon-screen-tablet', prevClass: 'tablet-preview', displayText: 'Tablet' },
  [resSizes.MD_SIZE]: { iconClass: 'icon-screen-desktop', prevClass: 'mobile-preview', displayText: 'Desktop' },
};
export default class GridEditModal extends React.Component {

  constructor(props) {
    super(props);

    this.state = {
      colsRatios: [6, 6],
      responsiveSize: BootstrapGrid.ResponsiveSize.XS_SIZE,
      show: false,
      gridHtml: '',
    };

    this.checkResposiveSize = this.checkResposiveSize.bind(this);
    this.checkColsRatios = this.checkColsRatios.bind(this);
    this.init = this.init.bind(this);
    this.show = this.show.bind(this);
    this.hide = this.hide.bind(this);
    this.cancel = this.cancel.bind(this);
    this.pasteCodedGrid = this.pasteCodedGrid.bind(this);
    this.renderSelectedGridPattern = this.renderSelectedGridPattern.bind(this);
    this.renderSelectedBreakPoint = this.renderSelectedBreakPoint.bind(this);
    this.renderNoBreakPreview = this.renderNoBreakPreview.bind(this);
    this.renderBreakPreview = this.renderBreakPreview.bind(this);
  }

  async checkResposiveSize(rs) {
    await this.setState({ responsiveSize: rs });
  }

  async checkColsRatios(cr) {
    await this.setState({ colsRatios: cr });
  }

  init(gridHtml) {
    const initGridHtml = gridHtml;
    this.setState({ gridHtml: initGridHtml }, function() {
      // display gridHtml for re-editing
      console.log(this.state.gridHtml);
    });
  }

  show(gridHtml) {
    this.init(gridHtml);
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
    const convertedHTML = geu.convertRatiosAndSizeToHTML(colsRatios, responsiveSize);
    const pastedGridData = `::: editable-row\n<div class="container">\n\t<div class="row">\n${convertedHTML}\n\t</div>\n</div>\n:::`;
    // display converted html on console
    console.log(convertedHTML);

    if (this.props.onSave != null) {
      this.props.onSave(pastedGridData);
    }
    this.cancel();
  }

  renderSelectedGridPattern() {
    const colsRatios = this.state.colsRatios;
    return colsRatios.join(' - ');
  }

  renderSelectedBreakPoint() {
    const output = Object.entries(resSizeObj).map((responsiveSizeForMap) => {
      return (this.state.responsiveSize === responsiveSizeForMap[0]
        && (
        <span>
          <i className={`pr-1 ${responsiveSizeForMap[1].iconClass}`}> {responsiveSizeForMap[1].displayText}</i>
        </span>
        )
      );
    });
    return output;
  }

  renderGridDivisionMenu() {
    const gridDivisions = geu.mappingAllGridDivisionPatterns;
    return (
      <div className="container">
        <div className="row">
          {gridDivisions.map((gridDivion, i) => {
            return (
              <div className="col-md-4 text-center">
                <h6 className="dropdown-header">{gridDivion.numberOfGridDivisions}分割</h6>
                {gridDivion.mapping.map((gridOneDivision) => {
                  return (
                    <button className="dropdown-item" type="button" onClick={() => { this.checkColsRatios(gridOneDivision) }}>
                      <div className="row">
                        {gridOneDivision.map((god) => {
                          const className = `bg-info col-${god} border`;
                          return <span className={className}>{god}</span>;
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

  renderBreakPointMenu() {
    const output = Object.entries(resSizeObj).map((responsiveSizeForMap) => {
      return (
        <button className="dropdown-item" type="button" onClick={() => { this.checkResposiveSize(responsiveSizeForMap[0]) }}>
          <i className={`pl-2 pr-1 ${responsiveSizeForMap[1].iconClass}`}></i> {responsiveSizeForMap[1].displayText}
        </button>
      );
    });
    return output;
  }

  renderPreview() {
    const prevSize = BootstrapGrid.ResponsiveSize;
    const prevSizeObj = {
      [prevSize.MD_SIZE]: {
        [prevSize.MD_SIZE]: {
          iconClass: 'icon-screen-desktop', prevClass: 'desktop-preview', prevText: 'Desktop', prevRender: this.renderNoBreakPreview(),
        },
        [prevSize.SM_SIZE]: {
          iconClass: 'icon-screen-tablet', prevClass: 'tablet-preview', prevText: 'Tablet', prevRender: this.renderBreakPreview(),
        },
        [prevSize.XS_SIZE]: {
          iconClass: 'icon-screen-smartphone', prevClass: 'mobile-preview', prevText: 'Smartphone', prevRender: this.renderBreakPreview(),
        },
      },
      [prevSize.SM_SIZE]: {
        [prevSize.MD_SIZE]: {
          iconClass: 'icon-screen-desktop', prevClass: 'desktop-preview', prevText: 'Desktop', prevRender: this.renderNoBreakPreview(),
        },
        [prevSize.SM_SIZE]: {
          iconClass: 'icon-screen-tablet', prevClass: 'tablet-preview', prevText: 'Tablet', prevRender: this.renderNoBreakPreview(),
        },
        [prevSize.XS_SIZE]: {
          iconClass: 'icon-screen-smartphone', prevClass: 'mobile-preview', prevText: 'Smartphone', prevRender: this.renderBreakPreview(),
        },
      },
      [prevSize.MD_SIZE]: {
        [prevSize.MD_SIZE]: {
          iconClass: 'icon-screen-desktop', prevClass: 'desktop-preview', prevText: 'Desktop', prevRender: this.renderNoBreakPreview(),
        },
        [prevSize.SM_SIZE]: {
          iconClass: 'icon-screen-tablet', prevClass: 'tablet-preview', prevText: 'Tablet', prevRender: this.renderNoBreakPreview(),
        },
        [prevSize.XS_SIZE]: {
          iconClass: 'icon-screen-smartphone', prevClass: 'mobile-preview', prevText: 'Smartphone', prevRender: this.renderNoBreakPreview(),
        },
      },
    };
    if (this.state.responsiveSize === BootstrapGrid.ResponsiveSize.MD_SIZE) {
      return (
        <>
          <div className="col-6">
            <label className="d-block"><i className="pr-2 icon-screen-desktop"></i>Desktop</label>
            <div className="desktop-preview d-block">
              {this.renderNoBreakPreview()}
            </div>
          </div>
          <div className="col-3">
            <label className="d-block"><i className="pr-2 icon-screen-tablet"></i>Tablet</label>
            <div className="tablet-preview d-block">
              {this.renderBreakPreview()}
            </div>
          </div>
          <div className="col-3">
            <label className="d-block"><i className="pr-2 icon-screen-smartphone"></i>Mobile</label>
            <div className="mobile-preview d-block">
              {this.renderBreakPreview()}
            </div>
          </div>
        </>
      );
    }
    if (this.state.responsiveSize === BootstrapGrid.ResponsiveSize.SM_SIZE) {
      return (
        <>
          <div className="col-6">
            <label className="d-block"><i className="pr-2 icon-screen-desktop"></i>Desktop</label>
            <div className="desktop-preview d-block">
              {this.renderNoBreakPreview()}
            </div>
          </div>
          <div className="col-3">
            <label className="d-block"><i className="pr-2 icon-screen-tablet"></i>Tablet</label>
            <div className="tablet-preview d-block">
              {this.renderNoBreakPreview()}
            </div>
          </div>
          <div className="col-3">
            <label className="d-block"><i className="pr-2 icon-screen-smartphone"></i>Mobile</label>
            <div className="mobile-preview d-block">
              {this.renderBreakPreview()}
            </div>
          </div>
        </>
      );
    }
    if (this.state.responsiveSize === BootstrapGrid.ResponsiveSize.XS_SIZE) {
      return (
        <>
          <div className="col-6">
            <label className="d-block"><i className="pr-2 icon-screen-desktop"></i>Desktop</label>
            <div className="desktop-preview d-block">
              {this.renderNoBreakPreview()}
            </div>
          </div>
          <div className="col-3">
            <label className="d-block"><i className="pr-2 icon-screen-tablet"></i>Tablet</label>
            <div className="tablet-preview d-block">
              {this.renderNoBreakPreview()}
            </div>
          </div>
          <div className="col-3">
            <label className="d-block"><i className="pr-2 icon-screen-smartphone"></i>Mobile</label>
            <div className="mobile-preview d-block">
              {this.renderNoBreakPreview()}
            </div>
          </div>
        </>
      );
    }
  }

  renderNoBreakPreview() {
    const { colsRatios } = this.state;
    const convertedHTML = colsRatios.map((colsRatios) => {
      const className = `col-${colsRatios} border`;
      return (
        <div className={className}></div>
      );
    });
    return (
      <div className="row">{convertedHTML}</div>
    );
  }

  renderBreakPreview() {
    const { colsRatios } = this.state;
    const convertedHTML = colsRatios.map(() => {
      const className = 'col-12 border';
      return (
        <div className={className}></div>
      );
    });
    return (
      <div className="row">{convertedHTML}</div>
    );
  }

  render() {
    return (
      <Modal isOpen={this.state.show} toggle={this.cancel} size="xl" className="grw-grid-edit-modal">
        <ModalHeader tag="h4" toggle={this.cancel} className="bg-primary text-light">
          Create Bootstrap 4 Grid
        </ModalHeader>
        <ModalBody>
          <div className="container">
            <div className="row">
              <div className="col-6">
                <div className="mr-3 d-inline">
                  <label htmlFor="gridPattern">Grid Pattern :</label>
                </div>
                <button
                  className="btn btn-outline-secondary dropdown-toggle text-right col-12 col-md-auto"
                  type="button"
                  id="dropdownMenuButton"
                  data-toggle="dropdown"
                  aria-haspopup="true"
                  aria-expanded="false"
                >
                  {this.renderSelectedGridPattern()}
                </button>
                <div className="dropdown-menu grid-division-menu" aria-labelledby="dropdownMenuButton">
                  {this.renderGridDivisionMenu()}
                </div>
              </div>
              <div className="col-6">
                <div className="mr-3 d-inline">
                  <label htmlFor="breakPoint">Break point by display size :</label>
                </div>
                <div
                  className="btn btn-outline-secondary dropdown-toggle text-right col-12 col-md-auto"
                  type="button"
                  id="dropdownMenuButton"
                  data-toggle="dropdown"
                  aria-haspopup="true"
                  aria-expanded="false"
                >
                  {this.renderSelectedBreakPoint()}
                </div>
                <div className="dropdown-menu break-point-menu" aria-labelledby="dropdownMenuButton">
                  {this.renderBreakPointMenu()}
                </div>
              </div>
            </div>
            <div className="row">
              <h1 className="pl-3 w-100">Preview</h1>
              {this.renderPreview()}
            </div>
          </div>
        </ModalBody>
        <ModalFooter className="grw-modal-footer">
          <div className="ml-auto">
            <button type="button" className="mr-2 btn btn-secondary" onClick={this.cancel}>
              Cancel
            </button>
            <button type="button" className="btn btn-primary" onClick={this.pasteCodedGrid}>
              Done
            </button>
          </div>
        </ModalFooter>
      </Modal>
    );
  }

}

GridEditModal.propTypes = {
  onSave: PropTypes.func,
};
