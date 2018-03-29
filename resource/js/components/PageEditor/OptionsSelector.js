import React from 'react';
import PropTypes from 'prop-types';

import FormGroup from 'react-bootstrap/es/FormGroup';
import FormControl from 'react-bootstrap/es/FormControl';
import ControlLabel from 'react-bootstrap/es/ControlLabel';
import Button from 'react-bootstrap/es/Button';

import Dropdown from 'react-bootstrap/es/Dropdown';
import MenuItem from 'react-bootstrap/es/MenuItem';

import OverlayTrigger  from 'react-bootstrap/es/OverlayTrigger';
import Tooltip from 'react-bootstrap/es/Tooltip';

export default class OptionsSelector extends React.Component {

  constructor(props) {
    super(props);

    const config = this.props.crowi.getConfig();
    const isMathJaxEnabled = !!config.env.MATHJAX;

    this.state = {
      editorOptions: this.props.editorOptions || new EditorOptions(),
      previewOptions: this.props.previewOptions || new PreviewOptions(),
      isCddMenuOpened: false,
      isMathJaxEnabled,
    }

    this.availableThemes = [
      'elegant', 'neo', 'mdn-like', 'material', 'monokai', 'twilight'
    ]

    this.onChangeTheme = this.onChangeTheme.bind(this);
    this.onClickStyleActiveLine = this.onClickStyleActiveLine.bind(this);
    this.onClickRenderMathJaxInRealtime = this.onClickRenderMathJaxInRealtime.bind(this);
    this.onToggleConfigurationDropdown = this.onToggleConfigurationDropdown.bind(this);
  }

  componentDidMount() {
    this.init();
  }

  init() {
    this.themeSelectorInputEl.value = this.state.editorOptions.theme;
  }

  onChangeTheme() {
    const newValue = this.themeSelectorInputEl.value;
    const newOpts = Object.assign(this.state.editorOptions, {theme: newValue});
    this.setState({editorOptions: newOpts});

    // dispatch event
    this.dispatchOnChange();
  }

  onClickStyleActiveLine(event) {
    // keep dropdown opened
    this._cddForceOpen = true;

    const newValue = !this.state.editorOptions.styleActiveLine;
    const newOpts = Object.assign(this.state.editorOptions, {styleActiveLine: newValue});
    this.setState({editorOptions: newOpts});

    // dispatch event
    this.dispatchOnChange();
  }

  onClickRenderMathJaxInRealtime(event) {
    // keep dropdown opened
    this._cddForceOpen = true;

    const newValue = !this.state.previewOptions.renderMathJaxInRealtime;
    const newOpts = Object.assign(this.state.previewOptions, {renderMathJaxInRealtime: newValue});
    this.setState({previewOptions: newOpts});

    // dispatch event
    this.dispatchOnChange();
  }

  /*
   * see: https://github.com/react-bootstrap/react-bootstrap/issues/1490#issuecomment-207445759
   */
  onToggleConfigurationDropdown(newValue) {
    if (this._cddForceOpen) {
      this.setState({ isCddMenuOpened: true });
      this._cddForceOpen = false;
    }
    else {
      this.setState({ isCddMenuOpened: newValue });
    }
  }

  /**
   * dispatch onChange event
   */
  dispatchOnChange() {
    if (this.props.onChange != null) {
      this.props.onChange(this.state.editorOptions, this.state.previewOptions);
    }
  }

  renderThemeSelector() {
    const optionElems = this.availableThemes.map((theme) => {
      return <option key={theme} value={theme}>{theme}</option>;
    });

    const bsClassName = 'form-control-dummy'; // set form-control* to shrink width

    return (
      <FormGroup controlId="formControlsSelect">
        <ControlLabel>Theme:</ControlLabel>
        <FormControl componentClass="select" placeholder="select" bsClass={bsClassName} className="btn-group-sm selectpicker"
            onChange={this.onChangeTheme}
            inputRef={ el => this.themeSelectorInputEl=el }>

          {optionElems}

        </FormControl>
      </FormGroup>
    )
  }

  renderConfigurationDropdown() {
    return (
      <FormGroup controlId="formControlsSelect">

        <Dropdown dropup id="configurationDropdown" className="configuration-dropdown"
            open={this.state.isCddMenuOpened} onToggle={this.onToggleConfigurationDropdown}>

          <Dropdown.Toggle bsSize="sm">
            <i className="icon-settings"></i>
          </Dropdown.Toggle>

          <Dropdown.Menu>
            {this.renderActiveLineMenuItem()}
            {this.renderRealtimeMathJaxMenuItem()}
            {/* <MenuItem divider /> */}
          </Dropdown.Menu>

        </Dropdown>

      </FormGroup>
    )
  }

  renderActiveLineMenuItem() {
    const isActive = this.state.editorOptions.styleActiveLine;

    const iconClasses = ['text-info']
    if (isActive) {
      iconClasses.push('ti-check')
    }
    const iconClassName = iconClasses.join(' ');

    return (
      <MenuItem onClick={this.onClickStyleActiveLine}>
        <span className="icon-container"></span>
        <span className="menuitem-label">Show active line</span>
        <span className="icon-container"><i className={iconClassName}></i></span>
      </MenuItem>
    )
  }

  renderRealtimeMathJaxMenuItem() {
    if (!this.state.isMathJaxEnabled) {
      return;
    }

    const isEnabled = this.state.isMathJaxEnabled;
    const isActive = isEnabled && this.state.previewOptions.renderMathJaxInRealtime;

    const iconClasses = ['text-info']
    if (isActive) {
      iconClasses.push('ti-check')
    }
    const iconClassName = iconClasses.join(' ');

    return (
      <MenuItem onClick={this.onClickRenderMathJaxInRealtime}>
        <span className="icon-container"><img src="/images/icons/fx.svg" width="14px"></img></span>
        <span className="menuitem-label">MathJax Rendering</span>
        <i className={iconClassName}></i>
      </MenuItem>
    )
  }

  render() {
    return <span>
      <span className="m-l-5">{this.renderThemeSelector()}</span>
      <span className="m-l-5">{this.renderConfigurationDropdown()}</span>
    </span>
  }
}

export class EditorOptions {
  constructor(props) {
    this.theme = 'elegant';
    this.styleActiveLine = false;

    Object.assign(this, props);
  }
}

export class PreviewOptions {
  constructor(props) {
    this.renderMathJaxInRealtime = false;

    Object.assign(this, props);
  }
}

OptionsSelector.propTypes = {
  crowi: PropTypes.object.isRequired,
  editorOptions: PropTypes.instanceOf(EditorOptions),
  previewOptions: PropTypes.instanceOf(PreviewOptions),
  onChange: PropTypes.func,
};
