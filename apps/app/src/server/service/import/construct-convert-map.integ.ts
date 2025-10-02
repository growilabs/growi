import type { EventEmitter } from 'events';

import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import { setupIndependentModels, setupModelsDependentOnCrowi } from '~/server/crowi/setup-models';

import { constructConvertMap } from './construct-convert-map';

describe('constructConvertMap', () => {

  beforeAll(async() => {
    const events = {
      page: mock<EventEmitter>(),
      user: mock<EventEmitter>(),
    };
    const crowiMock = mock<Crowi>({
      event: (name: string) => events[name],
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
