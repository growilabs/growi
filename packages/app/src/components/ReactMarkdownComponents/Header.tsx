import { Element } from 'react-markdown/lib/rehype-filter';

import { NextLink } from './NextLink';


type EditLinkProps = {
  line?: number,
}

/**
 * Inner FC to display edit link icon
 */
const EditLink = (props: EditLinkProps): JSX.Element => {
  const isDisabled = props.line == null;

  return (
    <span className="revision-head-edit-button">
      <a href="#edit" aria-disabled={isDisabled} onClick={() => console.log(`TODO: Jump to the line '${props.line}'`)}>
        <i className="icon-note"></i>
      </a>
    </span>
  );
};


type HeaderProps = {
  children: React.ReactNode,
  node: Element,
  level: number,
  id?: string,
}

export const Header = (props: HeaderProps): JSX.Element => {
  const {
    node, id, children, level,
  } = props;

  const CustomTag = `h${level}` as keyof JSX.IntrinsicElements;

  return (
    <CustomTag id={id} className="revision-head">
      {children}
      <NextLink href={`#${id}`} className="revision-head-link">
        <span className="icon-link"></span>
      </NextLink>
      <EditLink line={node.position?.start.line} />
    </CustomTag>
  );
};
