import React from 'react';
import { useTranslation } from 'next-i18next';
import PropTypes from 'prop-types';

class StatusTable extends React.PureComponent {
  renderPreInitializedLabel() {
    return <span className="badge text-bg-default">――</span>;
  }

  renderConnectionStatusLabels() {
    const { t } = this.props;
    const { isErrorOccuredOnSearchService, isConnected, isConfigured } =
      this.props;

    const errorOccuredLabel = isErrorOccuredOnSearchService ? (
      <span className="badge text-bg-danger ms-2">
        {t('full_text_search_management.connection_status_label_erroroccured')}
      </span>
    ) : null;

    let connectionStatusLabel = null;
    if (!isConfigured) {
      connectionStatusLabel = (
        <span className="badge text-bg-default">
          {t(
            'full_text_search_management.connection_status_label_unconfigured',
          )}
        </span>
      );
    } else {
      connectionStatusLabel = isConnected ? (
        <span
          data-testid="connection-status-badge-connected"
          className="badge text-bg-success"
        >
          {t('full_text_search_management.connection_status_label_connected')}
        </span>
      ) : (
        <span className="badge text-bg-danger">
          {t(
            'full_text_search_management.connection_status_label_disconnected',
          )}
        </span>
      );
    }

    return (
      <>
        {connectionStatusLabel}
        {errorOccuredLabel}
      </>
    );
  }

  renderIndicesStatusLabel() {
    const { t, isNormalized } = this.props;

    return isNormalized ? (
      <span className="badge text-bg-info">
        {t('full_text_search_management.indices_status_label_normalized')}
      </span>
    ) : (
      <span className="badge text-bg-warning">
        {t('full_text_search_management.indices_status_label_unnormalized')}
      </span>
    );
  }

  renderIndexInfoPanel(indexName, body = {}, aliases = []) {
    const collapseId = `collapse-${indexName}`;

    const aliasLabels = aliases.map((aliasName) => {
      return (
        <span
          key={`badge-${indexName}-${aliasName}`}
          className="badge text-bg-primary me-2"
        >
          <span className="material-symbols-outlined">sell</span>
          <span>{aliasName}</span>
        </span>
      );
    });

    return (
      <div className="card">
        <div className="card-header">
          <button
            type="button"
            className="text-nowrap me-2 btn btn-link p-0"
            data-bs-toggle="collapse"
            data-bs-target={`#${collapseId}`}
            aria-expanded="true"
            aria-controls={collapseId}
          >
            <span className="material-symbols-outlined">database</span>{' '}
            {indexName}
          </button>
          <span className="ms-md-3">{aliasLabels}</span>
        </div>
        <div id={collapseId} className="collapse">
          <div className="card-body">
            <pre>{JSON.stringify(body, null, 2)}</pre>
          </div>
        </div>
      </div>
    );
  }

  renderIndexInfoPanels() {
    const { indicesData, aliasesData } = this.props;

    // data is null
    if (indicesData == null) {
      return null;
    }

    /*
      "indices": {
        "growi": {
          ...
        }
      },
    */
    const indexNameToDataMap = {};
    for (const [indexName, indexData] of Object.entries(indicesData)) {
      indexNameToDataMap[indexName] = indexData;
    }

    // no indices
    if (indexNameToDataMap.length === 0) {
      return null;
    }

    /*
      "aliases": {
        "growi": {
          "aliases": {
            "growi-alias": {}
          }
        }
      },
    */
    const indexNameToAliasMap = {};
    for (const [indexName, aliasData] of Object.entries(aliasesData)) {
      indexNameToAliasMap[indexName] = Object.keys(aliasData.aliases);
    }

    return (
      <div className="row">
        {Object.keys(indexNameToDataMap).map((indexName) => {
          return (
            <div key={`col-${indexName}`} className="col-md-6">
              {this.renderIndexInfoPanel(
                indexName,
                indexNameToDataMap[indexName],
                indexNameToAliasMap[indexName],
              )}
            </div>
          );
        })}
      </div>
    );
  }

  render() {
    const { t } = this.props;
    const { isInitialized } = this.props;

    return (
      <table className="table table-bordered">
        <tbody>
          <tr>
            <th className="w-25">
              {t('full_text_search_management.connection_status')}
            </th>
            <td className="w-75">
              {isInitialized
                ? this.renderConnectionStatusLabels()
                : this.renderPreInitializedLabel()}
            </td>
          </tr>
          <tr>
            <th className="w-25">
              {t('full_text_search_management.indices_status')}
            </th>
            <td className="w-75">
              {isInitialized
                ? this.renderIndicesStatusLabel()
                : this.renderPreInitializedLabel()}
            </td>
          </tr>
          <tr>
            <th className="w-25">
              {t('full_text_search_management.indices_summary')}
            </th>
            <td className="p-4 w-75">
              {isInitialized && this.renderIndexInfoPanels()}
            </td>
          </tr>
        </tbody>
      </table>
    );
  }
}

const StatusTableWrapperFC = (props) => {
  const { t } = useTranslation('admin');

  return <StatusTable t={t} {...props} />;
};

StatusTable.propTypes = {
  t: PropTypes.func.isRequired, // i18next

  isInitialized: PropTypes.bool,
  isErrorOccuredOnSearchService: PropTypes.bool,

  isConnected: PropTypes.bool,
  isConfigured: PropTypes.bool,
  isNormalized: PropTypes.bool,
  indicesData: PropTypes.object,
  aliasesData: PropTypes.object,
};

export default StatusTableWrapperFC;
