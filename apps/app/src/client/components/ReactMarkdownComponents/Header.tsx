import { type JSX, useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { globalEventTarget } from '@growi/core/dist/utils';
import type { Element } from 'hast';

import { useStartEditing } from '~/client/services/use-start-editing';
import { NextLink } from '~/components/ReactMarkdownComponents/NextLink';
import {
  useCurrentPageYjsData,
  useCurrentPageYjsDataLoading,
} from '~/features/collaborative-editor/states';
import {
  useIsGuestUser,
  useIsReadOnlyUser,
  useIsSharedUser,
} from '~/states/context';
import { useCurrentPagePath } from '~/states/page';
import { useShareLinkId } from '~/states/page/hooks';
import type { ReservedNextCaretLineEventDetail } from '~/states/ui/editor/reserved-next-caret-line';
import loggerFactory from '~/utils/logger';

import styles from './Header.module.scss';

const logger = loggerFactory('growi:components:Header');
const moduleClass = styles['revision-head'] ?? '';

function setCaretLine(lineNumber?: number): void {
  if (lineNumber != null) {
    globalEventTarget.dispatchEvent(
      new CustomEvent<ReservedNextCaretLineEventDetail>(
        'reservedNextCaretLine',
        {
          detail: {
            lineNumber,
          },
        },
      ),
    );
  }
}

type EditLinkProps = {
  line?: number;
};

/**
 * Inner FC to display edit link icon
 */
export const EditLink = (props: EditLinkProps): JSX.Element => {
  const isDisabled = props.line == null;
  const startEditing = useStartEditing();
  const currentPagePath = useCurrentPagePath();

  const onClickHandler = useCallback(() => {
    setCaretLine(props.line);
    void startEditing(currentPagePath);
  }, [currentPagePath, props.line, startEditing]);

  return (
    <span className="revision-head-edit-button">
      <button
        type="button"
        className="border-0 bg-transparent p-0"
        disabled={isDisabled}
        onClick={onClickHandler}
      >
        {/* aria-hidden: decorative icon only, the button's accessible name should not include its glyph text */}
        <span className="material-symbols-outlined" aria-hidden="true">
          edit_square
        </span>
      </button>
    </span>
  );
};

// Extends JSX.IntrinsicElements['h1'] so react-markdown's original HTML attributes
// (style, class, etc.) forward instead of being silently dropped.
type HeaderProps = JSX.IntrinsicElements['h1'] & {
  node: Element;
};

// Narrowed to the tags Header is actually assigned to (h1-h6 in generateViewOptions),
// so the {...rest} spread below stays assignable to CustomTag.
type HeadingTagName = 'h1' | 'h2' | 'h3' | 'h4' | 'h5' | 'h6';

export const Header = (props: HeaderProps): JSX.Element => {
  const { node, id, children, className, ...rest } = props;

  const isGuestUser = useIsGuestUser();
  const isReadOnlyUser = useIsReadOnlyUser();
  const isSharedUser = useIsSharedUser();
  const shareLinkId = useShareLinkId();
  const currentPageYjsData = useCurrentPageYjsData();
  const isLoadingCurrentPageYjsData = useCurrentPageYjsDataLoading();

  const router = useRouter();

  const [isActive, setActive] = useState(false);

  const CustomTag = node.tagName as HeadingTagName;

  const activateByHash = useCallback(
    (url: string) => {
      try {
        const hash = new URL(url, 'https://example.com').hash.slice(1);
        setActive(decodeURIComponent(hash) === id);
      } catch (err) {
        logger.debug(err);
        setActive(false);
      }
    },
    [id],
  );

  // init
  useEffect(() => {
    activateByHash(window.location.href);
  }, [activateByHash]);

  // update isActive when hash is changed by next router
  useEffect(() => {
    router.events.on('hashChangeComplete', activateByHash);

    return () => {
      router.events.off('hashChangeComplete', activateByHash);
    };
  }, [activateByHash, router.events]);

  // update isActive when hash is changed
  useEffect(() => {
    const activeByHashWrapper = (e: HashChangeEvent) => {
      activateByHash(e.newURL);
    };

    window.addEventListener('hashchange', activeByHashWrapper);

    return () => {
      window.removeEventListener('hashchange', activeByHashWrapper);
    };
  }, [activateByHash]);

  // TODO: currentPageYjsData?.hasYdocsNewerThanLatestRevision === false make to hide the edit button when a Yjs draft exists
  // This is because the current conditional logic cannot handle cases where the draft is an empty string.
  // It will be possible to address this TODO ySyncAnnotation become available for import.
  // Ref: https://github.com/yjs/y-codemirror.next/pull/30
  const showEditButton =
    !isGuestUser &&
    !isReadOnlyUser &&
    !isSharedUser &&
    shareLinkId == null &&
    !isLoadingCurrentPageYjsData &&
    !currentPageYjsData?.hasYdocsNewerThanLatestRevision;

  return (
    <>
      <CustomTag
        {...rest}
        id={id}
        className={`position-relative ${moduleClass} ${isActive ? styles.blink : ''} ${className ?? ''}`}
      >
        <NextLink
          href={`#${id}`}
          className="d-none d-md-inline revision-head-link position-absolute"
        >
          #
        </NextLink>

        {children}

        {showEditButton && <EditLink line={node.position?.start.line} />}
      </CustomTag>
    </>
  );
};
