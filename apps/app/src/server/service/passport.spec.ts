import type { MockInstance } from 'vitest';
import { mock } from 'vitest-mock-extended';

import type Crowi from '~/server/crowi';
import type UserEvent from '~/server/events/user';

import { configManager } from './config-manager';
import PassportService from './passport';

describe('PassportService test', () => {
  let crowiMock;

  beforeAll(async () => {
    crowiMock = mock<Crowi>({
      event: vi.fn().mockImplementation((eventName) => {
        if (eventName === 'user') {
          return mock<UserEvent>({
            on: vi.fn(),
          });
        }
      }),
    });
  });

  describe('verifySAMLResponseByABLCRule()', () => {
    const passportService = new PassportService(crowiMock);

    let getConfigSpy: MockInstance<typeof configManager.getConfig>;
    let extractAttributesFromSAMLResponseSpy: MockInstance<
      typeof passportService.extractAttributesFromSAMLResponse
    >;

    beforeEach(async () => {
      // prepare spy for ConfigManager.getConfig
      getConfigSpy = vi.spyOn(configManager, 'getConfig');
      // prepare spy for extractAttributesFromSAMLResponse method
      extractAttributesFromSAMLResponseSpy = vi.spyOn(
        passportService,
        'extractAttributesFromSAMLResponse',
      );
    });

    /* eslint-disable indent */
    let i = 0;
    describe.each`
      conditionId | departments   | positions     | ruleStr                                                   | expected
      ${i++}      | ${undefined}  | ${undefined}  | ${' '}                                                    | ${true}
      ${i++}      | ${undefined}  | ${undefined}  | ${'Department: A'}                                        | ${false}
      ${i++}      | ${[]}         | ${['Leader']} | ${'Position'}                                             | ${true}
      ${i++}      | ${[]}         | ${['Leader']} | ${'Position: Leader'}                                     | ${true}
      ${i++}      | ${['A']}      | ${[]}         | ${'Department: A || Department: B && Position: Leader'}   | ${true}
      ${i++}      | ${['B']}      | ${['Leader']} | ${'Department: A || Department: B && Position: Leader'}   | ${true}
      ${i++}      | ${['A', 'C']} | ${['Leader']} | ${'Department: A || Department: B && Position: Leader'}   | ${true}
      ${i++}      | ${['B', 'C']} | ${['Leader']} | ${'Department: A || Department: B && Position: Leader'}   | ${true}
      ${i++}      | ${[]}         | ${[]}         | ${'Department: A || Department: B && Position: Leader'}   | ${false}
      ${i++}      | ${['C']}      | ${['Leader']} | ${'Department: A || Department: B && Position: Leader'}   | ${false}
      ${i++}      | ${['A']}      | ${['Leader']} | ${'(Department: A || Department: B) && Position: Leader'} | ${true}
      ${i++}      | ${['B']}      | ${['Leader']} | ${'(Department: A || Department: B) && Position: Leader'} | ${true}
      ${i++}      | ${['C']}      | ${['Leader']} | ${'(Department: A || Department: B) && Position: Leader'} | ${false}
      ${i++}      | ${['A', 'B']} | ${[]}         | ${'(Department: A || Department: B) && Position: Leader'} | ${false}
      ${i++}      | ${['A']}      | ${[]}         | ${'Department: A NOT Position: Leader'}                   | ${true}
      ${i++}      | ${['A']}      | ${['Leader']} | ${'Department: A NOT Position: Leader'}                   | ${false}
      ${i++}      | ${[]}         | ${['Leader']} | ${'Department: A OR (Position NOT Position: User)'}       | ${true}
      ${i++}      | ${[]}         | ${['User']}   | ${'Department: A OR (Position NOT Position: User)'}       | ${false}
    `(
      'to be $expected under rule="$ruleStr"',
      ({ conditionId, departments, positions, ruleStr, expected }) => {
        test(`when conditionId=${conditionId}`, async () => {
          const responseMock = {};

          // setup mock implementation
          getConfigSpy.mockImplementation((key) => {
            if (key === 'security:passport-saml:ABLCRule') {
              return ruleStr;
            }
            throw new Error('Unexpected behavior.');
          });
          extractAttributesFromSAMLResponseSpy.mockImplementation(
            (response) => {
              if (response !== responseMock) {
                throw new Error('Unexpected args.');
              }
              return {
                Department: departments,
                Position: positions,
              };
            },
          );

          const result =
            passportService.verifySAMLResponseByABLCRule(responseMock);

          expect(result).toBe(expected);
        });
      },
    );
  });
});
