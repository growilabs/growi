import path from 'path';

import { projectRoot } from '~/utils/project-dir-utils';

export const cdnLocalScriptRoot = path.join(
  projectRoot,
  'public/static/js/cdn',
);
export const cdnLocalScriptWebRoot = '/static/js/cdn';
export const cdnLocalStyleRoot = path.join(
  projectRoot,
  'public/static/styles/cdn',
);
export const cdnLocalStyleWebRoot = '/static/styles/cdn';
