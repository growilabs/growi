import { remarkGrowiDirectivePlugin } from './remark-growi-directive.js';

export {
  DirectiveTypeObject as remarkGrowiDirectivePluginType,
  LeafGrowiPluginDirective,
  LeafGrowiPluginDirectiveData,
  TextGrowiPluginDirective,
  TextGrowiPluginDirectiveData,
} from './mdast-util-growi-directive';

export default remarkGrowiDirectivePlugin;
