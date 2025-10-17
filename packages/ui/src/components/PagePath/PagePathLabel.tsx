import type { FC, ReactNode } from 'react';
import { DevidedPagePath } from '@growi/core/dist/models';

type TextElemProps = {
  children?: ReactNode;
  isHTML?: boolean;
};

const TextElement: FC<TextElemProps> = (props: TextElemProps) => (
  <>
    {props.isHTML ? (
      <span
        // biome-ignore lint/security/noDangerouslySetInnerHtml: ignore
        dangerouslySetInnerHTML={{ __html: props.children?.toString() || '' }}
      />
    ) : (
      props.children
    )}
  </>
);

type Props = {
  path: string;
  isLatterOnly?: boolean;
  isFormerOnly?: boolean;
  isPathIncludedHtml?: boolean;
  additionalClassNames?: string[];
};

export const PagePathLabel: FC<Props> = (props: Props) => {
  const {
    isLatterOnly,
    isFormerOnly,
    isPathIncludedHtml,
    additionalClassNames,
    path,
  } = props;

  const dPagePath = new DevidedPagePath(path, false, true);

  const classNames = additionalClassNames || [];

  let textElem: JSX.Element | undefined;

  if (isLatterOnly) {
    textElem = (
      <TextElement isHTML={isPathIncludedHtml}>{dPagePath.latter}</TextElement>
    );
  } else if (isFormerOnly) {
    textElem = dPagePath.isFormerRoot ? (
      // biome-ignore lint/complexity/noUselessFragments: ignore
      <>/</>
    ) : (
      <TextElement isHTML={isPathIncludedHtml}>{dPagePath.former}</TextElement>
    );
  } else {
    textElem = dPagePath.isRoot ? (
      <strong>/</strong>
    ) : (
      <TextElement isHTML={isPathIncludedHtml}>
        {dPagePath.former}/<strong>{dPagePath.latter}</strong>
      </TextElement>
    );
  }

  return <span className={classNames.join(' ')}>{textElem}</span>;
};
