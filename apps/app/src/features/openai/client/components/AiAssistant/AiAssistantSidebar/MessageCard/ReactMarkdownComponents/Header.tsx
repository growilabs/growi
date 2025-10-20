type Level = 1 | 2 | 3 | 4 | 5 | 6;

const fontSizes: Record<Level, string> = {
  1: '1.5rem',
  2: '1.25rem',
  3: '1rem',
  4: '0.875rem',
  5: '0.75rem',
  6: '0.625rem',
};

export const Header = ({
  children,
  level,
}: {
  children: React.ReactNode;
  level: Level;
}): JSX.Element => {
  const Tag = `h${level}` as keyof JSX.IntrinsicElements;

  return (
    <Tag
      style={{
        fontSize: fontSizes[level],
        lineHeight: 1.4,
      }}
    >
      {children}
    </Tag>
  );
};
