/**
 * InstallerDriver
 *
 * Automates GROWI's /api/v3/installer endpoint to create an admin user and
 * establish an authenticated session.  This is the entry point for the
 * load-driver: all subsequent page CRUD / search / Yjs operations reuse the
 * session cookie obtained here.
 *
 * The payload mirrors the registerForm structure consumed by the installer
 * route (apps/app/src/server/routes/apiv3/installer.ts).
 */

import type { HttpClient } from './http-client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InstallerDriverResult {
  readonly adminEmail: string;
  readonly adminPassword: string;
  /** Raw Set-Cookie value for the established session. */
  readonly cookie: string;
}

export interface InstallerDriver {
  initInstaller(): Promise<InstallerDriverResult>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Default admin credentials used during profiling sessions. */
const DEFAULT_ADMIN_NAME = 'Profiling Admin';
const DEFAULT_ADMIN_USERNAME = 'profiling-admin';
const DEFAULT_ADMIN_EMAIL = 'profiling-admin@example.com';
const DEFAULT_ADMIN_PASSWORD = 'ProfilingAdmin1234!';

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a new InstallerDriver that operates through the provided HttpClient.
 *
 * The HttpClient's built-in cookie jar automatically stores the session cookie
 * returned by the installer endpoint, so no extra cookie wiring is needed.
 */
export function createInstallerDriver(httpClient: HttpClient): InstallerDriver {
  const adminEmail = DEFAULT_ADMIN_EMAIL;
  const adminPassword = DEFAULT_ADMIN_PASSWORD;

  /**
   * Calls POST /api/v3/installer with the default admin credentials.
   *
   * GROWI's installer endpoint sets a session cookie in the response when
   * the admin user is successfully created and logged in.
   *
   * @returns The admin credentials and the session cookie header value.
   * @throws  If the installer endpoint returns a non-2xx status.
   */
  const initInstaller = async (): Promise<InstallerDriverResult> => {
    const response = await httpClient.post('/_api/v3/installer', {
      registerForm: {
        name: DEFAULT_ADMIN_NAME,
        username: DEFAULT_ADMIN_USERNAME,
        email: adminEmail,
        password: adminPassword,
        'app:globalLang': 'en_US',
      },
    });

    // The installer returns 200 on success and sets the session cookie.
    if (!response.ok && response.status !== 200) {
      const bodyText = await response.text().catch(() => '(unreadable)');
      throw new Error(
        `Installer endpoint returned HTTP ${response.status}: ${bodyText}`,
      );
    }

    // The session cookie is already stored in the HttpClient's cookie jar
    // by the time we reach here.  Extract it from the response header for
    // informational purposes.
    const setCookieHeader = response.headers.get('set-cookie') ?? '';

    return {
      adminEmail,
      adminPassword,
      cookie: setCookieHeader,
    };
  };

  return { initInstaller };
}
