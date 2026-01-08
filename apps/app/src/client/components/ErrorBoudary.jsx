import React from 'react';
import PropTypes from 'prop-types';

/**
 * @see https://reactjs.org/docs/error-boundaries.html
 */
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null, errorInfo: null };
  }

  componentDidCatch(error, errorInfo) {
    // You can also log the error to an error reporting service
    // logErrorToMyService(error, errorInfo);

    // Catch errors in any components below and re-render with error message
    this.setState({
      error,
      errorInfo,
    });
  }

  render() {
    const { error, errorInfo } = this.state;
    if (errorInfo != null) {
      // split componetStack
      // see https://regex101.com/r/Uc448G/1
      const firstStack = errorInfo.componentStack.split(/\s*in\s/)[1];

      return (
        <div className="card border-danger">
          <div className="card-header">Error occured in {firstStack}</div>
          <div className="card-body">
            <h5>{error && error.toString()}</h5>
            <details
              className="card custom-card small mb-0"
              style={{ whiteSpace: 'pre-wrap' }}
            >
              {errorInfo.componentStack}
            </details>
          </div>
        </div>
      );
    }

    // Normally, just render children
    return this.props.children;
  }
}

ErrorBoundary.propTypes = {
  children: PropTypes.object,
};

export default ErrorBoundary;
