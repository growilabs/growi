import React from 'react';
import PropTypes from 'prop-types';

import LabeledProgressBar from '../Common/LabeledProgressBar';

class RebuildIndexControls extends React.Component {
  renderProgressBar() {
    const {
      isRebuildingProcessing,
      isRebuildingCompleted,
      currentCount,
      totalCount,
      progressHeaderProcessing,
      progressHeaderCompleted,
    } = this.props;
    const showProgressBar = isRebuildingProcessing || isRebuildingCompleted;

    if (!showProgressBar) {
      return null;
    }

    const header = isRebuildingCompleted
      ? progressHeaderCompleted
      : progressHeaderProcessing;

    return (
      <div className="mb-3">
        <LabeledProgressBar
          header={header}
          currentCount={currentCount}
          totalCount={totalCount}
          isInProgress={isRebuildingProcessing}
        />
      </div>
    );
  }

  render() {
    const { isEnabled, buttonLabel, descriptionLines } = this.props;

    return (
      <>
        {this.renderProgressBar()}

        <button
          type="submit"
          className="btn btn-primary"
          onClick={() => {
            this.props.onRebuildingRequested();
          }}
          disabled={!isEnabled}
        >
          {buttonLabel}
        </button>

        <p className="form-text text-muted">
          {descriptionLines.map((line) => (
            <React.Fragment key={line}>
              {line}
              <br />
            </React.Fragment>
          ))}
        </p>
      </>
    );
  }
}

RebuildIndexControls.propTypes = {
  isEnabled: PropTypes.bool.isRequired,
  isRebuildingProcessing: PropTypes.bool.isRequired,
  isRebuildingCompleted: PropTypes.bool.isRequired,
  currentCount: PropTypes.number.isRequired,
  totalCount: PropTypes.number.isRequired,
  progressHeaderProcessing: PropTypes.string.isRequired,
  progressHeaderCompleted: PropTypes.string.isRequired,
  buttonLabel: PropTypes.string.isRequired,
  descriptionLines: PropTypes.arrayOf(PropTypes.string).isRequired,
  onRebuildingRequested: PropTypes.func.isRequired,
};

export default RebuildIndexControls;
