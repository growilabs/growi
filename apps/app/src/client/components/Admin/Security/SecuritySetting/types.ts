import { PageDeleteConfigValue, type IPageDeleteConfigValue } from '~/interfaces/page-delete-config';

export const DeletionTypeForT = Object.freeze({
  Deletion: 'deletion',
  CompleteDeletion: 'complete_deletion',
  RecursiveDeletion: 'recursive_deletion',
  RecursiveCompleteDeletion: 'recursive_complete_deletion',
} as const);

export const DeletionType = Object.freeze({
  Deletion: 'deletion',
  CompleteDeletion: 'completeDeletion',
  RecursiveDeletion: 'recursiveDeletion',
  RecursiveCompleteDeletion: 'recursiveCompleteDeletion',
} as const);

export type DeletionTypeKey = keyof typeof DeletionType;
export type DeletionTypeValue = typeof DeletionType[DeletionTypeKey];

export const getDeletionTypeForT = (deletionType: DeletionTypeValue): string => {
  switch (deletionType) {
    case DeletionType.Deletion:
      return DeletionTypeForT.Deletion;
    case DeletionType.RecursiveDeletion:
      return DeletionTypeForT.RecursiveDeletion;
    case DeletionType.CompleteDeletion:
      return DeletionTypeForT.CompleteDeletion;
    case DeletionType.RecursiveCompleteDeletion:
      return DeletionTypeForT.RecursiveCompleteDeletion;
  }
};

export const getDeleteConfigValueForT = (deleteConfigValue: IPageDeleteConfigValue | null): string => {
  switch (deleteConfigValue) {
    case PageDeleteConfigValue.Anyone:
    case null:
      return 'security_settings.anyone';
    case PageDeleteConfigValue.Inherit:
      return 'security_settings.inherit';
    case PageDeleteConfigValue.AdminOnly:
      return 'security_settings.admin_only';
    case PageDeleteConfigValue.AdminAndAuthor:
      return 'security_settings.admin_and_author';
    default:
      return 'security_settings.anyone';
  }
};

/**
 * Return true if "deletionType" is DeletionType.RecursiveDeletion or DeletionType.RecursiveCompleteDeletion.
 * @param deletionType Deletion type
 * @returns boolean
 */
export const isRecursiveDeletion = (deletionType: DeletionTypeValue): boolean => {
  return deletionType === DeletionType.RecursiveDeletion || deletionType === DeletionType.RecursiveCompleteDeletion;
};

/**
 * Return true if "deletionType" is DeletionType.Deletion or DeletionType.RecursiveDeletion.
 * @param deletionType Deletion type
 * @returns boolean
 */
export const isTypeDeletion = (deletionType: DeletionTypeValue): boolean => {
  return deletionType === DeletionType.Deletion || deletionType === DeletionType.RecursiveDeletion;
};
