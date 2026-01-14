import type { ChangeSpec } from '@codemirror/state';

import type { Delta } from '../interfaces';

export const deltaToChangeSpecs = (delta: Delta): ChangeSpec[] => {
  const changes: ChangeSpec[] = [];
  let pos = 0;

  for (const op of delta) {
    if (op.retain != null) {
      pos += op.retain;
    }

    if (op.delete != null) {
      changes.push({
        from: pos,
        to: pos + op.delete,
      });
    }

    if (op.insert != null) {
      changes.push({
        from: pos,
        insert: typeof op.insert === 'string' ? op.insert : '',
      });
      if (typeof op.insert === 'string') {
        pos += op.insert.length;
      }
    }
  }

  return changes;
};
