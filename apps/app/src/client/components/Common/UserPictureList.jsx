import React from 'react';
import { UserPicture } from '@growi/ui/dist/components';
import PropTypes from 'prop-types';

export default class UserPictureList extends React.Component {
  render() {
    return this.props.users.map((user) => (
      <span key={user._id}>
        <UserPicture user={user} size="xs" />
      </span>
    ));
  }
}

UserPictureList.propTypes = {
  users: PropTypes.arrayOf(PropTypes.object),
};

UserPictureList.defaultProps = {
  users: [],
};
