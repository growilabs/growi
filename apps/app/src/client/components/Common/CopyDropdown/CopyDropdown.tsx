import React, {
  useState, useMemo, useCallback, type ReactNode, type CSSProperties,
} from 'react';

import { pagePathUtils } from '@growi/core/dist/utils';
import { useTranslation } from 'next-i18next';
import { CopyToClipboard } from 'react-copy-to-clipboard';
import {
  Dropdown, DropdownToggle, DropdownMenu, DropdownItem,
  Tooltip,
} from 'reactstrap';

import styles from './CopyDropdown.module.scss';

const { encodeSpaces } = pagePathUtils;

interface DropdownItemContentsProps {
  title: string;
  contents: ReactNode;
  className?: string;
  style?: CSSProperties;
}

interface CopyDropdownProps {
  children: ReactNode;
  dropdownToggleId: string;
  pagePath: string;
  pageId?: string;
  dropdownToggleClassName?: string;
  dropdownMenuContainer?: string | HTMLElement | React.RefObject<HTMLElement>;
  isShareLinkMode?: boolean;
}

/* eslint-disable react/prop-types */
const DropdownItemContents: React.FC<DropdownItemContentsProps> = ({
  title, contents, className = '', style,
}) => (
  <>
    <div className="h6 mt-1 mb-2"><strong>{title}</strong></div>
    <div className={`card mb-1 p-2 ${className}`} style={style}>{contents}</div>
  </>
);
/* eslint-enable react/prop-types */


export const CopyDropdown: React.FC<CopyDropdownProps> = (props) => {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [tooltipOpen, setTooltipOpen] = useState(false);
  const [isParamsAppended, setParamsAppended] = useState(!props.isShareLinkMode);

  /*
   * functions to construct labels and URLs
   */
  const getUriParams = useCallback(() => {
    if (!isParamsAppended || !dropdownOpen) {
      return '';
    }

    const {
      search, hash,
    } = window.location;

    return `${search}${hash}`;
  }, [isParamsAppended, dropdownOpen]);

  const pagePathWithParams = useMemo(() => {
    const { pagePath } = props;
    return decodeURI(`${pagePath}${getUriParams()}`);
  }, [props, getUriParams]);

  const pagePathUrl = useMemo(() => {
    const { origin } = window.location;
    return `${origin}${encodeSpaces(pagePathWithParams)}`;
  }, [pagePathWithParams]);

  const permalink = useMemo(() => {
    const { origin } = window.location;
    const { pageId, isShareLinkMode } = props;

    if (pageId == null) {
      return null;
    }
    if (isShareLinkMode) {
      return decodeURI(`${origin}/share/${pageId}`);
    }

    return encodeSpaces(decodeURI(`${origin}/${pageId}${getUriParams()}`));
  }, [props, getUriParams]);

  const markdownLink = useMemo(() => {
    const { pagePath } = props;

    const label = decodeURI(`${pagePath}${getUriParams()}`);
    // const permalink = generatePermalink();

    return `[${label}](${permalink})`;
  }, [props, getUriParams, permalink]);


  /**
   * control
   */
  const toggleDropdown = useCallback(() => {
    setDropdownOpen(!dropdownOpen);
  }, [dropdownOpen]);

  const toggleAppendParams = useCallback(() => {
    setParamsAppended(!isParamsAppended);
  }, [isParamsAppended]);

  const showToolTip = useCallback(() => {
    setTooltipOpen(true);
    setTimeout(() => {
      setTooltipOpen(false);
    }, 1000);
  }, []);


  /*
   * render
   */
  const { t } = useTranslation('commons');
  const {
    dropdownToggleId, pageId,
    dropdownToggleClassName,
    dropdownMenuContainer,
    children, isShareLinkMode,
  } = props;

  const customSwitchForParamsId = `customSwitchForParams_${dropdownToggleId}`;

  return (
    <>
      <Dropdown
        className={`${styles['grw-copy-dropdown']} grw-copy-dropdown d-print-none`}
        isOpen={dropdownOpen}
        size="sm"
        toggle={toggleDropdown}
      >
        <DropdownToggle
          caret={isShareLinkMode}
          className={`btn-copy ${dropdownToggleClassName}`}
        >
          <span id={dropdownToggleId}>{children}</span>
        </DropdownToggle>

        <DropdownMenu
          className={`${styles['copy-clipboard-dropdown-menu']}`}
          strategy="fixed"
          container={dropdownMenuContainer}
        >
          <div className="d-flex align-items-center justify-content-between">
            <DropdownItem header className="px-3">
              { t('copy_to_clipboard.Copy to clipboard') }
            </DropdownItem>
            { !isShareLinkMode && (
              <div className="px-3 form-check form-switch form-switch-sm">
                <input
                  type="checkbox"
                  id={customSwitchForParamsId}
                  className="form-check-input"
                  checked={isParamsAppended}
                  onChange={toggleAppendParams}
                />
                <label className="form-label form-check-label small" htmlFor={customSwitchForParamsId}>{ t('copy_to_clipboard.Append params') }</label>
              </div>
            ) }
          </div>

          <DropdownItem divider className="my-0"></DropdownItem>

          {/* Page path */}
          <CopyToClipboard text={pagePathWithParams} onCopy={showToolTip}>
            <DropdownItem className="px-3">
              <DropdownItemContents
                title={t('copy_to_clipboard.Page path')}
                contents={pagePathWithParams}
                className="text-truncate d-block"
              />
            </DropdownItem>
          </CopyToClipboard>

          <DropdownItem divider className="my-0"></DropdownItem>

          {/* Page path URL */}
          <CopyToClipboard text={pagePathUrl} onCopy={showToolTip}>
            <DropdownItem className="px-3">
              <DropdownItemContents
                title={t('copy_to_clipboard.Page URL')}
                contents={pagePathUrl}
                className="text-truncate d-block"
              />
            </DropdownItem>
          </CopyToClipboard>
          <DropdownItem divider className="my-0"></DropdownItem>

          {/* Permanent Link */}
          { pageId && (
            <CopyToClipboard text={permalink} onCopy={showToolTip}>
              <DropdownItem className="px-3">
                <DropdownItemContents
                  title={t('copy_to_clipboard.Permanent link')}
                  contents={permalink}
                  className="text-truncate d-block"
                />
              </DropdownItem>
            </CopyToClipboard>
          )}

          <DropdownItem divider className="my-0"></DropdownItem>

          {/* Page path + Permanent Link */}
          { pageId && (
            <CopyToClipboard text={`${pagePathWithParams}\n${permalink}`} onCopy={showToolTip}>
              <DropdownItem className="px-3">
                <DropdownItemContents
                  title={t('copy_to_clipboard.Page path and permanent link')}
                  contents={<>{pagePathWithParams}<br />{permalink}</>}
                  className="text-truncate d-block"
                />
              </DropdownItem>
            </CopyToClipboard>
          )}

          <DropdownItem divider className="my-0"></DropdownItem>

          {/* Markdown Link */}
          { pageId && (
            <CopyToClipboard text={markdownLink} onCopy={showToolTip}>
              <DropdownItem className="px-3 text-wrap">
                <DropdownItemContents title={t('copy_to_clipboard.Markdown link')} contents={markdownLink} />
              </DropdownItem>
            </CopyToClipboard>
          )}
        </DropdownMenu>

      </Dropdown>

      <Tooltip placement="bottom" isOpen={tooltipOpen} target={dropdownToggleId} fade={false}>
        copied!
      </Tooltip>
    </>
  );
};
