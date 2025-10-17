import type { HydratedDocument } from 'mongoose';
import { Types } from 'mongoose';
import { mock } from 'vitest-mock-extended';

import { getIdForRef, isPopulated } from './common';
import type { IPage, IPageHasId } from './page';

describe('isPopulated', () => {
  it('should return true when the argument implements HasObjectId', () => {
    // Arrange
    const ref = mock<IPageHasId>();

    // Act
    const result = isPopulated(ref);

    // Assert
    expect(result).toBe(true);
  });

  it('should return true when the argument is a mongoose Document', () => {
    // Arrange
    const ref = mock<HydratedDocument<IPage>>();

    // Act
    const result = isPopulated(ref);

    // Assert
    expect(result).toBe(true);
  });

  it('should return false when the argument is string', () => {
    // Arrange
    const ref = new Types.ObjectId().toString();

    // Act
    const result = isPopulated(ref);

    // Assert
    expect(result).toBe(false);
  });

  it('should return false when the argument is ObjectId', () => {
    // Arrange
    const ref = new Types.ObjectId();

    // Act
    const result = isPopulated(ref);

    // Assert
    expect(result).toBe(false);
  });
});

describe('getIdForRef', () => {
  it('should return the id string when the argument is populated', () => {
    // Arrange
    const id = new Types.ObjectId();
    const ref = mock<IPageHasId>({
      _id: id.toString(),
    });

    // Act
    const result = getIdForRef(ref);

    // Assert
    expect(result).toStrictEqual(id.toString());
  });

  it('should return the ObjectId when the argument is a mongoose Document', () => {
    // Arrange
    const id = new Types.ObjectId();
    const ref = mock<HydratedDocument<IPage>>({
      _id: id,
    });

    // Act
    const result = getIdForRef(ref);

    // Assert
    expect(result).toStrictEqual(id);
  });

  it('should return the id string as is when the argument is ObjectId', () => {
    // Arrange
    const ref = new Types.ObjectId();

    // Act
    const result = getIdForRef(ref);

    // Assert
    expect(result).toStrictEqual(ref);
  });

  it('should return the ObjectId as is when the argument is string', () => {
    // Arrange
    const ref = new Types.ObjectId().toString();

    // Act
    const result = getIdForRef(ref);

    // Assert
    expect(result).toStrictEqual(ref);
  });
});
