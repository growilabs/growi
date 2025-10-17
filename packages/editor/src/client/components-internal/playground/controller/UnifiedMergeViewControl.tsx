type UnifiedMergeViewControlProps = {
  onChange: (value: boolean) => void;
};

export const UnifiedMergeViewControl = ({
  onChange,
}: UnifiedMergeViewControlProps): JSX.Element => {
  return (
    <div className="row mt-5">
      <div className="col">
        <div className="form-check form-switch">
          <input
            className="form-check-input"
            type="checkbox"
            // biome-ignore lint/a11y/useAriaPropsForRole: ignore
            role="switch"
            id="flexSwitchCheckUnifiedMergeView"
            onChange={(e) => onChange(e.target.checked)}
          />
          <label
            className="form-check-label"
            htmlFor="flexSwitchCheckUnifiedMergeView"
          >
            Unified Merge View
          </label>
        </div>
      </div>
    </div>
  );
};
