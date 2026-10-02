type OutlineSecondaryButtonsProps<V> = {
  update: (value: V) => void;
  items: V[];
};

export const OutlineSecondaryButtons = <V extends { toString: () => string }>(
  props: OutlineSecondaryButtonsProps<V>,
): JSX.Element => {
  const { update, items } = props;
  return (
    <div className="d-flex flex-wrap gap-1">
      {items.map((item) => (
        <button
          key={item.toString()}
          type="button"
          className="btn btn-outline-secondary"
          onClick={() => update(item)}
        >
          {item.toString()}
        </button>
      ))}
    </div>
  );
};
