import { PageDeleteConfigValue } from '../interfaces/page-delete-config';
import { validateDeleteConfigs } from './page-delete-config';

describe('validateDeleteConfigs utility function', () => {
  test('Should validate delete configs', () => {
    const Anyone = PageDeleteConfigValue.Anyone;
    const AdminAndAuthor = PageDeleteConfigValue.AdminAndAuthor;
    const AdminOnly = PageDeleteConfigValue.AdminOnly;

    expect(validateDeleteConfigs(Anyone, Anyone)).toBe(true);
    expect(validateDeleteConfigs(Anyone, AdminAndAuthor)).toBe(true);
    expect(validateDeleteConfigs(Anyone, AdminOnly)).toBe(true);

    expect(validateDeleteConfigs(AdminAndAuthor, Anyone)).toBe(false);
    expect(validateDeleteConfigs(AdminAndAuthor, AdminAndAuthor)).toBe(true);
    expect(validateDeleteConfigs(AdminAndAuthor, AdminOnly)).toBe(true);

    expect(validateDeleteConfigs(AdminOnly, Anyone)).toBe(false);
    expect(validateDeleteConfigs(AdminOnly, AdminAndAuthor)).toBe(false);
    expect(validateDeleteConfigs(AdminOnly, AdminOnly)).toBe(true);
  });
});
