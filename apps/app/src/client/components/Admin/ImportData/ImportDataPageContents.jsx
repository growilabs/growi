import { withUnstatedContainers } from '../../UnstatedUtils.js';
import GrowiArchiveSection from './GrowiArchiveSection.js';

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
const ImportDataPageContentsWrapper = withUnstatedContainers(
  ImportDataPageContents,
  [],
);

export default ImportDataPageContentsWrapper;
