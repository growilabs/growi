import { convertDateStringsToDates } from './axios';

describe('convertDateStringsToDates', () => {

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
    const result = convertDateStringsToDates(input);
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.createdAt.toISOString()).toEqual(dateString);
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
    const result = convertDateStringsToDates(input);
    expect(result.data.item1.updatedAt).toBeInstanceOf(Date);
    expect(result.data.item1.updatedAt.toISOString()).toEqual(dateString1);
    expect(result.data.item2.nested.deletedAt).toBeInstanceOf(Date);
    expect(result.data.item2.nested.deletedAt.toISOString()).toEqual(dateString2);
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
      { id: 2, eventDate: new Date(dateString2), data: { nestedProp: 'value' } },
    ];
    const result = convertDateStringsToDates(input);
    expect(result[0].eventDate).toBeInstanceOf(Date);
    expect(result[0].eventDate.toISOString()).toEqual(dateString1);
    expect(result[1].eventDate).toBeInstanceOf(Date);
    expect(result[1].eventDate.toISOString()).toEqual(dateString2);
    expect(result).toEqual(expected);
  });

  // Test case 4: Array containing date strings directly (though less common for this function)
  test('should handle arrays containing date strings directly', () => {
    const dateString = '2023-06-20T18:00:00.000Z';
    const input = ['text', dateString, 123];
    const expected = ['text', new Date(dateString), 123];
    const result = convertDateStringsToDates(input);
    expect(result[1]).toBeInstanceOf(Date);
    expect(result[1].toISOString()).toEqual(dateString);
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
    const result = convertDateStringsToDates(input);
    expect(result).toEqual(originalInput); // Should be deeply equal
    expect(result).toBe(input); // Confirm it mutated the original object
  });

  // Test case 6: Null, undefined, and primitive values
  test('should return primitive values as is', () => {
    expect(convertDateStringsToDates(null)).toBeNull();
    expect(convertDateStringsToDates(undefined)).toBeUndefined();
    expect(convertDateStringsToDates(123)).toBe(123);
    expect(convertDateStringsToDates('hello')).toBe('hello');
    expect(convertDateStringsToDates(true)).toBe(true);
  });

  // Test case 7: Edge case - empty objects/arrays
  test('should handle empty objects and arrays correctly', () => {
    const emptyObject = {};
    const emptyArray = [];
    expect(convertDateStringsToDates(emptyObject)).toEqual({});
    expect(convertDateStringsToDates(emptyArray)).toEqual([]);
    expect(convertDateStringsToDates(emptyObject)).toBe(emptyObject);
    expect(convertDateStringsToDates(emptyArray)).toEqual(emptyArray);
  });

  // Test case 8: Date string with different milliseconds (isoDateRegex without .000)
  test('should handle date strings with varied milliseconds', () => {
    const dateString = '2023-01-15T10:00:00Z'; // No milliseconds
    const input = { createdAt: dateString };
    const expected = { createdAt: new Date(dateString) };
    const result = convertDateStringsToDates(input);
    expect(result.createdAt).toBeInstanceOf(Date);
    expect(result.createdAt.toISOString()).toEqual('2023-01-15T10:00:00.000Z');
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
    const result = convertDateStringsToDates(input);
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

    const result = convertDateStringsToDates(input);

    expect(result.eventTime).toBeInstanceOf(Date);
    expect(result.eventTime.toISOString()).toEqual(new Date(dateStringWithOffset).toISOString());
    expect(result.details.lastActivity).toBeInstanceOf(Date);
    expect(result.details.lastActivity.toISOString()).toEqual(new Date('2025-06-12T05:00:00-04:00').toISOString());

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

    const result = convertDateStringsToDates(input);

    expect(result.startTime).toBeInstanceOf(Date);
    expect(result.startTime.toISOString()).toEqual(new Date(dateStringWithNegativeOffset).toISOString());
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

    const result = convertDateStringsToDates(input);

    expect(result.zeroOffsetDate).toBeInstanceOf(Date);
    expect(result.zeroOffsetDate.toISOString()).toEqual(new Date(dateStringWithZeroOffset).toISOString());
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

    const result = convertDateStringsToDates(input);

    expect(result.detailedTime).toBeInstanceOf(Date);
    expect(result.detailedTime.toISOString()).toEqual(new Date(dateStringWithMsAndOffset).toISOString());
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

    const result = convertDateStringsToDates(input);

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

});
