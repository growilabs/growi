import React, {
  type JSX,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { useTranslation } from 'next-i18next';

import { GrowiArchiveImportOption } from '~/models/admin/growi-archive-import-option';
import { ImportOptionForPages } from '~/models/admin/import-option-for-pages';
import { ImportOptionForRevisions } from '~/models/admin/import-option-for-revisions';

import ImportCollectionConfigurationModal from './ImportData/GrowiArchive/ImportCollectionConfigurationModal';
import ImportCollectionItem, {
  DEFAULT_MODE,
  MODE_RESTRICTED_COLLECTION,
} from './ImportData/GrowiArchive/ImportCollectionItem';

const GROUPS_PAGE = ['pages', 'revisions', 'tags', 'pagetagrelations'];
const GROUPS_USER = [
  'users',
  'externalaccounts',
  'usergroups',
  'usergrouprelations',
];
const GROUPS_CONFIG = ['configs', 'updateposts', 'globalnotificationsettings'];
const ALL_GROUPED_COLLECTIONS =
  GROUPS_PAGE.concat(GROUPS_USER).concat(GROUPS_CONFIG);

const IMPORT_OPTION_CLASS_MAPPING: Record<
  string,
  typeof GrowiArchiveImportOption
> = {
  pages: ImportOptionForPages,
  revisions: ImportOptionForRevisions,
};

type Props = {
  allCollectionNames: string[];
  selectedCollections: Set<string>;
  updateSelectedCollections: (newSelectedCollections: Set<string>) => void;
  optionsMap: any;
  updateOptionsMap: (newOptionsMap: any) => void;
};

type ImportItemsProps = {
  collectionNames: string[];
  selectedCollections: Set<string>;
  optionsMap: Record<string, GrowiArchiveImportOption>;
  onToggleCollection: (collectionName: string, isChecked: boolean) => void;
  onOptionChange: (collectionName: string, data: any) => void;
  onConfigButtonClicked: (collectionName: string) => void;
};

const ImportItems = ({
  collectionNames,
  selectedCollections,
  optionsMap,
  onToggleCollection,
  onOptionChange,
  onConfigButtonClicked,
}: ImportItemsProps): JSX.Element => {
  return (
    <div className="row">
      {collectionNames.map((collectionName) => {
        const isConfigButtonAvailable = Object.keys(
          IMPORT_OPTION_CLASS_MAPPING,
        ).includes(collectionName);

        if (optionsMap[collectionName] == null) {
          return null;
        }

        return (
          <div className="col-md-6 my-1" key={collectionName}>
            <ImportCollectionItem
              isImporting={false}
              isImported={false}
              insertedCount={0}
              modifiedCount={0}
              errorsCount={0}
              collectionName={collectionName}
              isSelected={selectedCollections.has(collectionName)}
              option={optionsMap[collectionName]}
              isConfigButtonAvailable={isConfigButtonAvailable}
              // events
              onChange={onToggleCollection}
              onOptionChange={onOptionChange}
              onConfigButtonClicked={onConfigButtonClicked}
              // TODO: show progress
              isHideProgress
            />
          </div>
        );
      })}
    </div>
  );
};

type WarnForGroupsProps = {
  errors: Error[];
};

const WarnForGroups = ({ errors }: WarnForGroupsProps): JSX.Element => {
  if (errors.length === 0) {
    return <></>;
  }

  return (
    <div className="alert alert-warning">
      <ul>
        {errors.map((error, index) => {
          return <li key={`${error.message}-${index}`}>{error.message}</li>;
        })}
      </ul>
    </div>
  );
};

type GroupImportItemsProps = {
  groupList: string[];
  groupName: string;
  errors: Error[];
  allCollectionNames: string[];
  selectedCollections: Set<string>;
  optionsMap: Record<string, GrowiArchiveImportOption>;
  onToggleCollection: (collectionName: string, isChecked: boolean) => void;
  onOptionChange: (collectionName: string, data: any) => void;
  onConfigButtonClicked: (collectionName: string) => void;
};

const GroupImportItems = ({
  groupList,
  groupName,
  errors,
  allCollectionNames,
  selectedCollections,
  optionsMap,
  onToggleCollection,
  onOptionChange,
  onConfigButtonClicked,
}: GroupImportItemsProps): JSX.Element => {
  const collectionNames = groupList.filter((groupCollectionName) => {
    return allCollectionNames.includes(groupCollectionName);
  });

  if (collectionNames.length === 0) {
    return <></>;
  }

  return (
    <div className="mt-4">
      <legend>{groupName} Collections</legend>
      <ImportItems
        collectionNames={collectionNames}
        selectedCollections={selectedCollections}
        optionsMap={optionsMap}
        onToggleCollection={onToggleCollection}
        onOptionChange={onOptionChange}
        onConfigButtonClicked={onConfigButtonClicked}
      />
      <WarnForGroups errors={errors} />
    </div>
  );
};

type OtherImportItemsProps = {
  allCollectionNames: string[];
  selectedCollections: Set<string>;
  optionsMap: Record<string, GrowiArchiveImportOption>;
  onToggleCollection: (collectionName: string, isChecked: boolean) => void;
  onOptionChange: (collectionName: string, data: any) => void;
  onConfigButtonClicked: (collectionName: string) => void;
};

const OtherImportItems = ({
  allCollectionNames,
  selectedCollections,
  optionsMap,
  onToggleCollection,
  onOptionChange,
  onConfigButtonClicked,
}: OtherImportItemsProps): JSX.Element => {
  const collectionNames = allCollectionNames.filter((collectionName) => {
    return !ALL_GROUPED_COLLECTIONS.includes(collectionName);
  });

  // TODO: エラー対応
  return (
    <GroupImportItems
      groupList={collectionNames}
      groupName="Other"
      errors={[]}
      allCollectionNames={allCollectionNames}
      selectedCollections={selectedCollections}
      optionsMap={optionsMap}
      onToggleCollection={onToggleCollection}
      onOptionChange={onOptionChange}
      onConfigButtonClicked={onConfigButtonClicked}
    />
  );
};

const G2GDataTransferExportForm = (props: Props): JSX.Element => {
  const { t } = useTranslation('admin');

  const {
    allCollectionNames,
    selectedCollections,
    updateSelectedCollections,
    optionsMap,
    updateOptionsMap,
  } = props;

  const [isConfigurationModalOpen, setConfigurationModalOpen] = useState(false);
  const [collectionNameForConfiguration, setCollectionNameForConfiguration] =
    useState<any>();

  const checkAll = useCallback(() => {
    updateSelectedCollections(new Set(allCollectionNames));
  }, [allCollectionNames, updateSelectedCollections]);

  const uncheckAll = useCallback(() => {
    updateSelectedCollections(new Set());
  }, [updateSelectedCollections]);

  const updateOption = useCallback(
    (collectionName, data) => {
      const options = optionsMap[collectionName];

      // merge
      Object.assign(options, data);

      const updatedOptionsMap = {};
      updatedOptionsMap[collectionName] = options;
      updateOptionsMap((prev) => {
        return { ...prev, updatedOptionsMap };
      });
    },
    [optionsMap, updateOptionsMap],
  );

  const toggleCheckbox = useCallback(
    (collectionName, bool) => {
      const collections = new Set(selectedCollections);
      if (bool) {
        collections.add(collectionName);
      } else {
        collections.delete(collectionName);
      }

      updateSelectedCollections(collections);

      // TODO: validation
      // this.validate();
    },
    [selectedCollections, updateSelectedCollections],
  );

  const openConfigurationModal = useCallback((collectionName) => {
    setConfigurationModalOpen(true);
    setCollectionNameForConfiguration(collectionName);
  }, []);

  const configurationModal = useMemo(() => {
    if (collectionNameForConfiguration == null) {
      return <></>;
    }

    return (
      <ImportCollectionConfigurationModal
        isOpen={isConfigurationModalOpen}
        onClose={() => setConfigurationModalOpen(false)}
        onOptionChange={updateOption}
        collectionName={collectionNameForConfiguration}
        option={optionsMap[collectionNameForConfiguration]}
      />
    );
  }, [
    collectionNameForConfiguration,
    isConfigurationModalOpen,
    optionsMap,
    updateOption,
  ]);

  const setInitialOptionsMap = useCallback(() => {
    const initialOptionsMap = {};
    allCollectionNames.forEach((collectionName) => {
      const initialMode =
        MODE_RESTRICTED_COLLECTION[collectionName] != null
          ? MODE_RESTRICTED_COLLECTION[collectionName][0]
          : DEFAULT_MODE;
      const ImportOption =
        IMPORT_OPTION_CLASS_MAPPING[collectionName] || GrowiArchiveImportOption;
      initialOptionsMap[collectionName] = new ImportOption(
        collectionName,
        initialMode,
      );
    });
    updateOptionsMap(initialOptionsMap);
  }, [allCollectionNames, updateOptionsMap]);

  useEffect(() => {
    setInitialOptionsMap();
  }, [setInitialOptionsMap]);

  return (
    <>
      <form className="mt-3 row row-cols-lg-auto g-3 align-items-center">
        <div className="col-12">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary me-2"
            onClick={checkAll}
          >
            <span className="material-symbols-outlined">check_box</span>,{' '}
            {t('admin:export_management.check_all')}
          </button>
        </div>
        <div className="col-12">
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary me-2"
            onClick={uncheckAll}
          >
            <span className="material-symbols-outlined">
              check_box_outline_blank
            </span>{' '}
            {t('admin:export_management.uncheck_all')}
          </button>
        </div>
      </form>

      <div className="card custom-card small my-4">
        <ul>
          <li>
            {t(
              'admin:importer_management.growi_settings.description_of_import_mode.about',
            )}
          </li>
          <ul>
            <li>
              {t(
                'admin:importer_management.growi_settings.description_of_import_mode.insert',
              )}
            </li>
            <li>
              {t(
                'admin:importer_management.growi_settings.description_of_import_mode.upsert',
              )}
            </li>
            <li>
              {t(
                'admin:importer_management.growi_settings.description_of_import_mode.flash_and_insert',
              )}
            </li>
          </ul>
        </ul>
      </div>

      {/* TODO: エラー追加 */}
      <GroupImportItems
        groupList={GROUPS_PAGE}
        groupName="Page"
        errors={[]}
        allCollectionNames={allCollectionNames}
        selectedCollections={selectedCollections}
        optionsMap={optionsMap}
        onToggleCollection={toggleCheckbox}
        onOptionChange={updateOption}
        onConfigButtonClicked={openConfigurationModal}
      />
      <GroupImportItems
        groupList={GROUPS_USER}
        groupName="User"
        errors={[]}
        allCollectionNames={allCollectionNames}
        selectedCollections={selectedCollections}
        optionsMap={optionsMap}
        onToggleCollection={toggleCheckbox}
        onOptionChange={updateOption}
        onConfigButtonClicked={openConfigurationModal}
      />
      <GroupImportItems
        groupList={GROUPS_CONFIG}
        groupName="Config"
        errors={[]}
        allCollectionNames={allCollectionNames}
        selectedCollections={selectedCollections}
        optionsMap={optionsMap}
        onToggleCollection={toggleCheckbox}
        onOptionChange={updateOption}
        onConfigButtonClicked={openConfigurationModal}
      />
      <OtherImportItems
        allCollectionNames={allCollectionNames}
        selectedCollections={selectedCollections}
        optionsMap={optionsMap}
        onToggleCollection={toggleCheckbox}
        onOptionChange={updateOption}
        onConfigButtonClicked={openConfigurationModal}
      />

      {configurationModal}
    </>
  );
};

export default G2GDataTransferExportForm;
