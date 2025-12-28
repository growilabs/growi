import React from 'react';
import PropTypes from 'prop-types';
import {
  DropdownItem,
  DropdownMenu,
  DropdownToggle,
  UncontrolledDropdown,
} from 'reactstrap';

const PagingSizeUncontrolledDropdown = (props) => {
  function dropdownItemOnClickHandler(num) {
    if (props.onChangeDropdownItem === null) {
      return;
    }
    props.onChangeDropdownItem(num);
  }

  return (
    <React.Fragment>
      <div className="row">
        <div className="offset-md-2 col-md-7 text-start">
          <div className="my-0 w-100">
            <label className="form-label">{props.label}</label>
          </div>
          <UncontrolledDropdown>
            <DropdownToggle className="text-end col-6" caret>
              <span className="float-start">{props.toggleLabel}</span>
            </DropdownToggle>
            <DropdownMenu className="dropdown-menu" role="menu">
              {props.dropdownItemSize.map((num) => {
                return (
                  <DropdownItem
                    key={num}
                    role="presentation"
                    onClick={() => dropdownItemOnClickHandler(num)}
                  >
                    <a role="menuitem">{num}</a>
                  </DropdownItem>
                );
              })}
            </DropdownMenu>
          </UncontrolledDropdown>
          <p className="form-text text-muted">{props.desc}</p>
        </div>
      </div>
    </React.Fragment>
  );
};

PagingSizeUncontrolledDropdown.propTypes = {
  label: PropTypes.string,
  toggleLabel: PropTypes.number,
  dropdownItemSize: PropTypes.array,
  desc: PropTypes.string,
  onChangeDropdownItem: PropTypes.func,
};

export default PagingSizeUncontrolledDropdown;
