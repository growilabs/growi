type Props = {
  onClick: (event: React.MouseEvent<HTMLButtonElement, MouseEvent>) => void
};

export const SidebarHeaderReloadButton = ({ onClick }: Props): JSX.Element => {

  return (
    <button type="button" className="btn btn-sm ms-auto py-0 grw-btn-reload" onClick={onClick}>
      <span className="material-symbols-outlined">refresh</span>
    </button>
  );
};
