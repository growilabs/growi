import type { DateConvertible } from './axios';
import { convertStringsToDates } from './axios';

describe('convertStringsToDates', () => {
  // Test case 1: Basic conversion in a flat object
  test('should convert ISO date strings to Date objects in a flat object', () => {
    const dateString = '2023-01-15T10:00:00.000Z';
    const input = {
      id: 1,
      createdAt: dateString,
      name: 'Test Item',
    };
    const expected = {
      id: 1,
      createdAt: new Date(dateString),
      name: 'Test Item',
    };
    const result = convertStringsToDates(input) as Record<
      string,
      DateConvertible
    >;

    expect(result.createdAt).toBeInstanceOf(Date);

    if (result.createdAt instanceof Date) {
      expect(result.createdAt.toISOString()).toEqual(dateString);
    }

    expect(result).toEqual(expected);
  });

  // Test case 2: Nested objects
  test('should recursively convert ISO date strings in nested objects', () => {
    const dateString1 = '2023-02-20T12:30:00.000Z';
    const dateString2 = '2023-03-01T08:00:00.000Z';
    const input = {
      data: {
        item1: {
          updatedAt: dateString1,
          value: 10,
        },
        item2: {
          nested: {
            deletedAt: dateString2,
            isActive: false,
          },
        },
      },
    };
    const expected = {
      data: {
        item1: {
          updatedAt: new Date(dateString1),
          value: 10,
        },
        item2: {
          nested: {
            deletedAt: new Date(dateString2),
            isActive: false,
          },
        },
      },
    };
    const result = convertStringsToDates(input) as {
      data: {
        item1: {
          updatedAt: DateConvertible; // Assert 'updatedAt' later
          value: number;
        };
        item2: {
          nested: {
            deletedAt: DateConvertible; // Assert 'deletedAt' later
            isActive: boolean;
          };
        };
      };
    };
    expect(result.data.item1.updatedAt).toBeInstanceOf(Date);

    if (result.data.item1.updatedAt instanceof Date) {
      expect(result.data.item1.updatedAt.toISOString()).toEqual(dateString1);
      expect(result.data.item2.nested.deletedAt).toBeInstanceOf(Date);
    }

    if (result.data.item2.nested.deletedAt instanceof Date) {
      expect(result.data.item2.nested.deletedAt).toBeInstanceOf(Date);
      expect(result.data.item2.nested.deletedAt.toISOString()).toEqual(
        dateString2,
      );
    }

    expect(result).toEqual(expected);
  });

  // Test case 3: Arrays of objects
  test('should recursively convert ISO date strings in arrays of objects', () => {
    const dateString1 = '2023-04-05T14:15:00.000Z';
    const dateString2 = '2023-05-10T16:00:00.000Z';
    const input = [
      { id: 1, eventDate: dateString1 },
      { id: 2, eventDate: dateString2, data: { nestedProp: 'value' } },
    ];
    const expected = [
      { id: 1, eventDate: new Date(dateString1) },
      {
        id: 2,
        eventDate: new Date(dateString2),
        data: { nestedProp: 'value' },
      },
    ];
    const result = convertStringsToDates(input) as [
      { id: number; eventDate: DateConvertible },
      { id: number; eventDate: DateConvertible; data: { nestedProp: string } },
    ];

    expect(result[0].eventDate).toBeInstanceOf(Date);

    if (result[0].eventDate instanceof Date) {
      expect(result[0].eventDate.toISOString()).toEqual(dateString1);
    }

    if (result[1].eventDate instanceof Date) {
      expect(result[1].eventDate).toBeInstanceOf(Date);
      expect(result[1].eventDate.toISOString()).toEqual(dateString2);
    }

    expect(result).toEqual(expected);
  });

  // Test case 4: Array containing date strings directly (though less common for this function)
  test('should handle arrays containing date strings directly', () => {
    const dateString = '2023-06-20T18:00:00.000Z';
    const input: [string, string, number] = ['text', dateString, 123];
    const expected = ['text', new Date(dateString), 123];
    const result = convertStringsToDates(input) as DateConvertible[];

    expect(result[1]).toBeInstanceOf(Date);

    if (result[1] instanceof Date) {
      expect(result[1].toISOString()).toEqual(dateString);
    }

    expect(result).toEqual(expected);
  });

  // Test case 5: Data without date strings should remain unchanged
  test('should not modify data without ISO date strings', () => {
    const input = {
      name: 'Product A',
      price: 99.99,
      tags: ['electronic', 'sale'],
      description: 'Some text',
    };
    const originalInput = JSON.parse(JSON.stringify(input)); // Deep copy to ensure no mutation
    const result = convertStringsToDates(input);
    expect(result).toEqual(originalInput); // Should be deeply equal
    expect(result).not.toBe(input); // Confirm it mutated the original object
  });

  // Test case 6: Null, undefined, and primitive values
  test('should return primitive values as is', () => {
    expect(convertStringsToDates(null)).toBeNull();
    expect(convertStringsToDates(undefined)).toBeUndefined();
    expect(convertStringsToDates(123)).toBe(123);
    expect(convertStringsToDates('hello')).toBe('hello');
    expect(convertStringsToDates(true)).toBe(true);
  });

  // Test case 7: Edge case - empty objects/arrays
  test('should handle empty objects and arrays correctly', () => {
    const emptyObject = {};
    const emptyArray = [];
    expect(convertStringsToDates(emptyObject)).toEqual({});
    expect(convertStringsToDates(emptyArray)).toEqual([]);
    expect(convertStringsToDates(emptyObject)).not.toBe(emptyObject);
    expect(convertStringsToDates(emptyArray)).toEqual(emptyArray);
  });

  // Test case 8: Date string with different milliseconds (isoDateRegex without .000)
  test('should handle date strings with varied milliseconds', () => {
    const dateString = '2023-01-15T10:00:00Z'; // No milliseconds
    const input = { createdAt: dateString };
    const expected = { createdAt: new Date(dateString) };
    const result = convertStringsToDates(input) as Record<
      string,
      DateConvertible
    >;

    expect(result.createdAt).toBeInstanceOf(Date);

    if (result.createdAt instanceof Date) {
      expect(result.createdAt.toISOString()).toEqual(
        '2023-01-15T10:00:00.000Z',
      );
    }

    expect(result).toEqual(expected);
  });

  // Test case 9: Object with null properties
  test('should handle objects with null properties', () => {
    const dateString = '2023-07-01T00:00:00.000Z';
    const input = {
      prop1: dateString,
      prop2: null,
      prop3: {
        nestedNull: null,
        nestedDate: dateString,
      },
    };
    const expected = {
      prop1: new Date(dateString),
      prop2: null,
      prop3: {
        nestedNull: null,
        nestedDate: new Date(dateString),
      },
    };
    const result = convertStringsToDates(input) as {
      prop1: DateConvertible;
      prop2: null;
      prop3: {
        nestedNull: null;
        nestedDate: DateConvertible;
      };
    };
    expect(result.prop1).toBeInstanceOf(Date);
    expect(result.prop3.nestedDate).toBeInstanceOf(Date);
    expect(result).toEqual(expected);
  });

  // Test case 10: Date string with UTC offset (e.g., +09:00)
  test('should convert ISO date strings with UTC offset to Date objects', () => {
    const dateStringWithOffset = '2025-06-12T14:00:00+09:00';
    const input = {
      id: 2,
      eventTime: dateStringWithOffset,
      details: {
        lastActivity: '2025-06-12T05:00:00-04:00',
      },
    };
    const expected = {
      id: 2,
      eventTime: new Date(dateStringWithOffset),
      details: {
        lastActivity: new Date('2025-06-12T05:00:00-04:00'),
      },
    };

    const result = convertStringsToDates(input) as {
      id: number;
      eventTime: DateConvertible;
      details: {
        lastActivity: DateConvertible;
      };
    };

    expect(result.eventTime).toBeInstanceOf(Date);
    if (result.eventTime instanceof Date) {
      expect(result.eventTime.toISOString()).toEqual(
        new Date(dateStringWithOffset).toISOString(),
      );
    }

    expect(result.details.lastActivity).toBeInstanceOf(Date);
    if (result.details.lastActivity instanceof Date) {
      expect(result.details.lastActivity.toISOString()).toEqual(
        new Date('2025-06-12T05:00:00-04:00').toISOString(),
      );
    }

    expect(result).toEqual(expected);
  });

  // Test case 11: Date string with negative UTC offset
  test('should convert ISO date strings with negative UTC offset (-05:00) to Date objects', () => {
    const dateStringWithNegativeOffset = '2025-01-01T10:00:00-05:00';
    const input = {
      startTime: dateStringWithNegativeOffset,
    };
    const expected = {
      startTime: new Date(dateStringWithNegativeOffset),
    };

    const result = convertStringsToDates(input) as Record<
      string,
      DateConvertible
    >;

    expect(result.startTime).toBeInstanceOf(Date);
    if (result.startTime instanceof Date) {
      expect(result.startTime.toISOString()).toEqual(
        new Date(dateStringWithNegativeOffset).toISOString(),
      );
    }

    expect(result).toEqual(expected);
  });

  // Test case 12: Date string with zero UTC offset (+00:00)
  test('should convert ISO date strings with explicit zero UTC offset (+00:00) to Date objects', () => {
    const dateStringWithZeroOffset = '2025-03-15T12:00:00+00:00';
    const input = {
      zeroOffsetDate: dateStringWithZeroOffset,
    };
    const expected = {
      zeroOffsetDate: new Date(dateStringWithZeroOffset),
    };

    const result = convertStringsToDates(input) as Record<
      string,
      DateConvertible
    >;

    expect(result.zeroOffsetDate).toBeInstanceOf(Date);
    if (result.zeroOffsetDate instanceof Date) {
      expect(result.zeroOffsetDate.toISOString()).toEqual(
        new Date(dateStringWithZeroOffset).toISOString(),
      );
    }
    expect(result).toEqual(expected);
  });

  // Test case 13: Date string with milliseconds and UTC offset
  test('should convert ISO date strings with milliseconds and UTC offset to Date objects', () => {
    const dateStringWithMsAndOffset = '2025-10-20T23:59:59.999-07:00';
    const input = {
      detailedTime: dateStringWithMsAndOffset,
    };
    const expected = {
      detailedTime: new Date(dateStringWithMsAndOffset),
    };

    const result = convertStringsToDates(input) as Record<
      string,
      DateConvertible
    >;

    expect(result.detailedTime).toBeInstanceOf(Date);
    if (result.detailedTime instanceof Date) {
      expect(result.detailedTime.toISOString()).toEqual(
        new Date(dateStringWithMsAndOffset).toISOString(),
      );
    }
    expect(result).toEqual(expected);
  });

  // Test case 14: Should NOT convert strings that look like dates but are NOT ISO 8601 or missing timezone
  test('should NOT convert non-ISO 8601 date-like strings or strings missing timezone', () => {
    const nonIsoDate1 = '2025/06/12 14:00:00Z'; // Wrong separator
    const nonIsoDate2 = '2025-06-12T14:00:00'; // Missing timezone
    const nonIsoDate3 = 'June 12, 2025 14:00:00 GMT'; // Different format
    const nonIsoDate4 = '2025-06-12T14:00:00+0900'; // Missing colon in offset
    const nonIsoDate5 = '2025-06-12'; // Date only

    const input = {
      date1: nonIsoDate1,
      date2: nonIsoDate2,
      date3: nonIsoDate3,
      date4: nonIsoDate4,
      date5: nonIsoDate5,
      someOtherString: 'hello world',
    };

    // Deep copy to ensure comparison is accurate since the function modifies in place
    const expected = JSON.parse(JSON.stringify(input));

    const result = convertStringsToDates(input) as {
      date1: DateConvertible;
      date2: DateConvertible;
      date3: DateConvertible;
      date4: DateConvertible;
      date5: DateConvertible;
      someOtherString: string;
    };

    // Assert that they remain strings (or whatever their original type was)
    expect(typeof result.date1).toBe('string');
    expect(typeof result.date2).toBe('string');
    expect(typeof result.date3).toBe('string');
    expect(typeof result.date4).toBe('string');
    expect(typeof result.date5).toBe('string');
    expect(typeof result.someOtherString).toBe('string');

    // Ensure the entire object is unchanged for these properties
    expect(result.date1).toEqual(nonIsoDate1);
    expect(result.date2).toEqual(nonIsoDate2);
    expect(result.date3).toEqual(nonIsoDate3);
    expect(result.date4).toEqual(nonIsoDate4);
    expect(result.date5).toEqual(nonIsoDate5);
    expect(result.someOtherString).toEqual('hello world');

    // Finally, assert that the overall result is identical to the input for these non-matching strings
    expect(result).toEqual(expected);
  });

  describe('test circular reference occurrences', () => {
    // Test case 1: Circular references
    test('should handle circular references without crashing and preserve the cycle', () => {
      const dateString1 = '2023-02-20T12:30:00.000Z';
      const dateString2 = '2023-03-01T08:00:00.000Z';
      const dateString3 = '2023-04-05T14:15:00.000Z';

      const input: any = {
        data: {
          item1: {
            updatedAt: dateString1,
            value: 10,
          },
          item2: {
            nested1: {
              deletedAt: dateString2,
              isActive: false,
              nested2: {
                createdAt: dateString3,
                parent: null as any,
              },
            },
            anotherItem: {
              someValue: 42,
              lastSeen: '2023-11-01T12:00:00Z',
            },
          },
        },
      };

      // Create a circular reference
      input.data.item2.nested1.nested2.parent = input;

      const convertedOutput = convertStringsToDates(input) as {
        data: {
          item1: {
            updatedAt: DateConvertible;
            value: number;
          };
          item2: {
            nested1: {
              deletedAt: DateConvertible;
              isActive: boolean;
              nested2: {
                createdAt: DateConvertible;
                parent: any;
              };
            };
            anotherItem: {
              someValue: number;
              lastSeen: DateConvertible;
            };
          };
        };
      };

      // Expect the function not to have thrown an error
      expect(convertedOutput).toBeDefined();
      expect(convertedOutput).toBeInstanceOf(Object);

      // Check if circular reference is present
      expect(convertedOutput.data.item2.nested1.nested2.parent).toBe(input);

      // Check if the date conversion worked
      expect(convertedOutput.data.item1.updatedAt).toBeInstanceOf(Date);
      if (convertedOutput.data.item1.updatedAt instanceof Date) {
        expect(convertedOutput.data.item1.updatedAt.toISOString()).toBe(
          dateString1,
        );
      }

      expect(convertedOutput.data.item2.nested1.deletedAt).toBeInstanceOf(Date);
      if (convertedOutput.data.item2.nested1.deletedAt instanceof Date) {
        expect(convertedOutput.data.item2.nested1.deletedAt.toISOString()).toBe(
          dateString2,
        );
      }

      expect(
        convertedOutput.data.item2.nested1.nested2.createdAt,
      ).toBeInstanceOf(Date);
      if (
        convertedOutput.data.item2.nested1.nested2.createdAt instanceof Date
      ) {
        expect(
          convertedOutput.data.item2.nested1.nested2.createdAt.toISOString(),
        ).toBe(dateString3);
      }

      expect(convertedOutput.data.item2.anotherItem.lastSeen).toBeInstanceOf(
        Date,
      );
      if (convertedOutput.data.item2.anotherItem.lastSeen instanceof Date) {
        expect(
          convertedOutput.data.item2.anotherItem.lastSeen.toISOString(),
        ).toBe(new Date(input.data.item2.anotherItem.lastSeen).toISOString());
      }
    });

    // Test case 2: Direct self-reference
    test('should work when encountering direct self-references', () => {
      const obj: any = {};
      obj.self = obj;
      obj.createdAt = '2023-02-01T00:00:00Z';

      const converted = convertStringsToDates(obj) as Record<
        string,
        DateConvertible
      >;

      expect(converted).toBeDefined();
      expect(converted.self).toBe(obj);
      expect(converted.createdAt).toBeInstanceOf(Date);
    });
  });
});
