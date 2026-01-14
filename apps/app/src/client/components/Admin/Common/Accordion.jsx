import React, { useState } from 'react';
import PropTypes from 'prop-types';
import { Collapse } from 'reactstrap';

const Accordion = (props) => {
  const [isOpen, setIsOpen] = useState(props.isOpenDefault);
  return (
    <div className="accordion-item">
      <p className="accordion-header" id="headingOne">
        <button
          className={`accordion-button ${isOpen ? '' : 'collapsed'}`}
          type="button"
          data-bs-toggle="collapse"
          aria-expanded="true"
          onClick={() => setIsOpen((prevState) => !prevState)}
        >
          {props.title}
        </button>
      </p>
      <Collapse isOpen={isOpen}>
        <div className="accordion-body">{props.children}</div>
      </Collapse>
    </div>
  );
};

Accordion.propTypes = {
  title: PropTypes.node.isRequired,
  children: PropTypes.node.isRequired,
  isOpenDefault: PropTypes.bool,
};

Accordion.defaultProps = {
  isOpenDefault: false,
};

export default Accordion;
