import { memo, type JSX } from 'react';

export const EditorSettings = memo((): JSX.Element => {
  // const { t } = useTranslation();

  // const { data: dataEditorSettings, update: updateEditorSettings } = useEditorSettings();

  // const updateRulesHandler = useCallback(async() => {
  //   try {
  //     await updateEditorSettings({ textlintSettings: { textlintRules } });
  //     toastSuccess(t('toaster.update_successed', { target: 'Updated Textlint Settings', ns: 'commons' }));
  //   }
  //   catch (err) {
  //     toastError(err);
  //   }
  // }, [t, textlintRules, updateEditorSettings]);

  // useEffect(() => {
  //   initializeEditorSettings();
  // }, [initializeEditorSettings]);

  return (
    <div data-testid="grw-editor-settings">

      {/*
      <div className="row my-3">
        <div className="offset-4 col-5">
          <button
            data-testid="grw-editor-settings-update-button"
            type="button"
            className="btn btn-primary"
            onClick={updateRulesHandler}
          >
            {t('Update')}
          </button>
        </div>
      </div>
      */}
    </div>
  );
});
EditorSettings.displayName = 'EditorSettings';
