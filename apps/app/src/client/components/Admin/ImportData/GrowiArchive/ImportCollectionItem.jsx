import React from 'react';

import PropTypes from 'prop-types';
import {
  Progress, UncontrolledDropdown, DropdownToggle, DropdownMenu, DropdownItem,
} from 'reactstrap';

import { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option';


const MODE_ATTR_MAP = {
  insert: { color: 'info', icon: 'add_circle', label: 'Insert' },
  upsert: { color: 'success', icon: 'add_circle', label: 'Upsert' },
  flushAndInsert: { color: 'danger', icon: 'autorenew', label: 'Flush and Insert' },
};

export const DEFAULT_MODE = 'insert';

export const MODE_RESTRICTED_COLLECTION = {
  configs: ['flushAndInsert'],
  users: ['insert', 'upsert'],
  pages: ['upsert', 'flushAndInsert'],
};

export default class ImportCollectionItem extends React.Component {

  constructor(props) {
    super(props);

    this.changeHandler = this.changeHandler.bind(this);
    this.modeSelectedHandler = this.modeSelectedHandler.bind(this);
    this.configButtonClickedHandler = this.configButtonClickedHandler.bind(this);
    this.errorLinkClickedHandler = this.errorLinkClickedHandler.bind(this);
  }

  changeHandler(e) {
    const { collectionName, onChange } = this.props;

    if (onChange != null) {
      onChange(collectionName, e.target.checked);
    }
  }

  modeSelectedHandler(mode) {
    const { collectionName, onOptionChange } = this.props;

    if (onOptionChange == null) {
      return;
    }

    onOptionChange(collectionName, { mode });
  }

  // No toggle state needed when using UncontrolledDropdown

  configButtonClickedHandler() {
    const { collectionName, onConfigButtonClicked } = this.props;

    if (onConfigButtonClicked == null) {
      return;
    }

    onConfigButtonClicked(collectionName);
  }

  errorLinkClickedHandler() {
    const { collectionName, onErrorLinkClicked } = this.props;

    if (onErrorLinkClicked == null) {
      return;
    }

    onErrorLinkClicked(collectionName);
  }

  renderModeLabel(mode, isColorized = false) {
    const attrMap = MODE_ATTR_MAP[mode];
    const className = isColorized ? `text-${attrMap.color}` : '';
    return <span className={`text-nowrap ${className}`}><span className="material-symbols-outlined">{attrMap.icon}</span> {attrMap.label}</span>;
  }

  renderCheckbox() {
    const {
      collectionName, isSelected, isImporting,
    } = this.props;

    return (
      <div className="form-check form-check-info my-0">
        <input
          type="checkbox"
          id={collectionName}
          name={collectionName}
          className="form-check-input"
          value={collectionName}
          checked={isSelected}
          disabled={isImporting}
          onChange={this.changeHandler}
        />
        <label className="form-label text-capitalize form-check-label" htmlFor={collectionName}>
          {collectionName}
        </label>
      </div>
    );
  }

  renderModeSelector() {
    const {
      collectionName, option, isImporting,
    } = this.props;
    const currentMode = option?.mode || 'insert';
    const attrMap = MODE_ATTR_MAP[currentMode];
    const modes = MODE_RESTRICTED_COLLECTION[collectionName] || Object.keys(MODE_ATTR_MAP);

    return (
      <span className="d-inline-flex align-items-center">
        Mode:&nbsp;
        <UncontrolledDropdown size="sm" className="d-inline-block">
          <DropdownToggle color={attrMap.color} caret disabled={isImporting} id={`ddmMode-${collectionName}`}>
            {this.renderModeLabel(currentMode)}
          </DropdownToggle>
          <DropdownMenu>
            {modes.map(mode => (
              <DropdownItem
                key={`buttonMode_${mode}`}
                onClick={() => this.modeSelectedHandler(mode)}
              >
                {this.renderModeLabel(mode, true)}
              </DropdownItem>
            ))}
          </DropdownMenu>
        </UncontrolledDropdown>
      </span>
    );
  }

  renderConfigButton() {
    const { isImporting, isConfigButtonAvailable } = this.props;

    return (
      <button
        type="button"
        className="btn btn-outline-secondary btn-sm p-1 ms-2"
        disabled={isImporting || !isConfigButtonAvailable}
        onClick={isConfigButtonAvailable ? this.configButtonClickedHandler : null}
      >
        <span className="material-symbols-outlined">settings</span>
      </button>
    );
  }

  renderProgressBar() {
    const {
      isImporting, insertedCount, modifiedCount, errorsCount,
    } = this.props;

    const total = insertedCount + modifiedCount + errorsCount;

    return (
      <Progress multi className="mb-0">
        <Progress bar max={total} color="info" striped={isImporting} animated={isImporting} value={insertedCount} />
        <Progress bar max={total} color="success" striped={isImporting} animated={isImporting} value={modifiedCount} />
        <Progress bar max={total} color="danger" striped={isImporting} animated={isImporting} value={errorsCount} />
      </Progress>
    );
  }

  renderBody() {
    const { isImporting, isImported } = this.props;

    if (!isImporting && !isImported) {
      return 'Ready';
    }

    const { insertedCount, modifiedCount, errorsCount } = this.props;
    return (
      <div className="w-100 text-center">
        <span className="text-info"><strong>{insertedCount}</strong> Inserted</span>,&nbsp;
        <span className="text-success"><strong>{modifiedCount}</strong> Modified</span>,&nbsp;
        { errorsCount > 0
          ? <a className="text-danger" role="button" onClick={this.errorLinkClickedHandler}><u><strong>{errorsCount}</strong> Failed</u></a>
          : <span className="text-muted"><strong>0</strong> Failed</span>
        }
      </div>
    );
  }

  render() {
    const {
      isSelected, isHideProgress,
    } = this.props;

    return (
      <div className="card border-light">
        <div className="card-header bg-light text-dark">
          <div className="d-flex justify-content-between align-items-center flex-wrap">
            {/* left */}
            {this.renderCheckbox()}
            {/* right */}
            <span className="d-flex align-items-center">
              {this.renderModeSelector()}
              {this.renderConfigButton()}
            </span>
          </div>
        </div>
        {isSelected && !isHideProgress && (
          <>
            {this.renderProgressBar()}
            <div className="card-body">{this.renderBody()}</div>
          </>
        )}
      </div>
    );
  }

}

ImportCollectionItem.propTypes = {
  collectionName: PropTypes.string.isRequired,
  isSelected: PropTypes.bool.isRequired,
  isHideProgress: PropTypes.bool,
  option: PropTypes.instanceOf(GrowiArchiveImportOption).isRequired,

  isImporting: PropTypes.bool.isRequired,
  isImported: PropTypes.bool.isRequired,
  insertedCount: PropTypes.number,
  modifiedCount: PropTypes.number,
  errorsCount: PropTypes.number,

  isConfigButtonAvailable: PropTypes.bool,

  onChange: PropTypes.func,
  onOptionChange: PropTypes.func,
  onConfigButtonClicked: PropTypes.func,
  onErrorLinkClicked: PropTypes.func,
};

ImportCollectionItem.defaultProps = {
  insertedCount: 0,
  modifiedCount: 0,
  errorsCount: 0,
};
