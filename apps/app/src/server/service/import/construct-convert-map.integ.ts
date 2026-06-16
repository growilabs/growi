import type { EventEmitter } from 'events';
import { mock } from 'vitest-mock-extended';

import type Crowi from '../../crowi';
import {
  setupIndependentModels,
  setupModelsDependentOnCrowi,
} from '../../crowi/setup-models';
import type UserEvent from '../../events/user';
import { constructConvertMap } from './construct-convert-map';

describe('constructConvertMap', () => {
  beforeAll(async () => {
    // PageEvent is a JS file with type 'any' in Crowi interface
    const crowiMock = mock<Crowi>({
      events: {
        page: mock<EventEmitter>(),
        user: mock<UserEvent>(),
      },
    });

    await setupModelsDependentOnCrowi(crowiMock);
    await setupIndependentModels();
  });

  test('should return convert map', () => {
    // arrange

    // act
    const result = constructConvertMap();

    // assert
    expect(result).not.toBeNull();
    expect(Object.keys(result).length).toEqual(33);
  });
});
