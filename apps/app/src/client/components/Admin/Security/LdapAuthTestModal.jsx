import React from 'react';
import PropTypes from 'prop-types';
import { Modal, ModalBody, ModalHeader } from 'reactstrap';

import { withUnstatedContainers } from '../../UnstatedUtils';
import { LdapAuthTest } from './LdapAuthTest';

class LdapAuthTestModal extends React.Component {
  constructor(props) {
    super(props);

    this.state = {
      username: '',
      password: '',
    };

    this.onChangeUsername = this.onChangeUsername.bind(this);
    this.onChangePassword = this.onChangePassword.bind(this);
  }

  /**
   * Change username
   */
  onChangeUsername(username) {
    this.setState({ username });
  }

  /**
   * Change password
   */
  onChangePassword(password) {
    this.setState({ password });
  }

  render() {
    return (
      <Modal isOpen={this.props.isOpen} toggle={this.props.onClose}>
        <ModalHeader tag="h4" toggle={this.props.onClose} className="text-info">
          Test LDAP Account
        </ModalHeader>
        <ModalBody>
          <LdapAuthTest
            username={this.state.username}
            password={this.state.password}
            onChangeUsername={this.onChangeUsername}
            onChangePassword={this.onChangePassword}
          />
        </ModalBody>
      </Modal>
    );
  }
}

LdapAuthTestModal.propTypes = {
  isOpen: PropTypes.bool.isRequired,
  onClose: PropTypes.func.isRequired,
};

/**
 * @type {React.ComponentType<{ isOpen: boolean, onClose: () => void }>}
 */
const LdapAuthTestModalWrapper = withUnstatedContainers(LdapAuthTestModal, []);

export default LdapAuthTestModalWrapper;
