import { withUnstatedContainers } from '../../UnstatedUtils';

import GrowiArchiveSection from './GrowiArchiveSection';

const ImportDataPageContents = () => {
  return (
    <div data-testid="admin-import-data">
      <GrowiArchiveSection />
    </div>
  );
};

/**
 * Wrapper component for using unstated
 */
const ImportDataPageContentsWrapper = withUnstatedContainers(ImportDataPageContents, []);

export default ImportDataPageContentsWrapper;
