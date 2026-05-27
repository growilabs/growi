import { patchStencilRegistryUrls } from './patch-stencil-registry-urls';

describe('patchStencilRegistryUrls', () => {
  it('should replace viewer.diagrams.net origin with the local origin', () => {
    // Arrange
    const libraries: Record<string, string[]> = {
      basic: [
        'https://viewer.diagrams.net/shapes/basic/cube.xml',
        'https://viewer.diagrams.net/stencils/basic/sphere.xml',
      ],
      arrows: ['https://viewer.diagrams.net/shapes/arrows/arrow.xml'],
    };

    // Act
    patchStencilRegistryUrls(libraries, 'http://localhost:8080');

    // Assert
    expect(libraries).toEqual({
      basic: [
        'http://localhost:8080/shapes/basic/cube.xml',
        'http://localhost:8080/stencils/basic/sphere.xml',
      ],
      arrows: ['http://localhost:8080/shapes/arrows/arrow.xml'],
    });
  });

  it('should mutate libraries in place', () => {
    // Arrange
    const libraries: Record<string, string[]> = {
      basic: ['https://viewer.diagrams.net/shapes/basic/cube.xml'],
    };
    const ref = libraries;

    // Act
    patchStencilRegistryUrls(libraries, 'http://localhost:8080');

    // Assert
    expect(ref).toBe(libraries);
    expect(ref.basic[0]).toBe('http://localhost:8080/shapes/basic/cube.xml');
  });

  it('should leave URLs without the viewer.diagrams.net origin unchanged', () => {
    // Arrange
    const libraries: Record<string, string[]> = {
      mixed: [
        'https://viewer.diagrams.net/shapes/a.xml',
        'https://example.com/shapes/b.xml',
        '/relative/path/c.xml',
      ],
    };

    // Act
    patchStencilRegistryUrls(libraries, 'http://localhost:8080');

    // Assert
    expect(libraries.mixed).toEqual([
      'http://localhost:8080/shapes/a.xml',
      'https://example.com/shapes/b.xml',
      '/relative/path/c.xml',
    ]);
  });

  it('should be idempotent on a second invocation', () => {
    // Arrange
    const libraries: Record<string, string[]> = {
      basic: ['https://viewer.diagrams.net/shapes/basic/cube.xml'],
    };

    // Act
    patchStencilRegistryUrls(libraries, 'http://localhost:8080');
    patchStencilRegistryUrls(libraries, 'http://localhost:8080');

    // Assert
    expect(libraries.basic).toEqual([
      'http://localhost:8080/shapes/basic/cube.xml',
    ]);
  });

  it('should not throw when libraries is undefined', () => {
    // Act & Assert
    expect(() =>
      patchStencilRegistryUrls(undefined, 'http://localhost:8080'),
    ).not.toThrow();
  });

  it('should handle an empty libraries object', () => {
    // Arrange
    const libraries: Record<string, string[]> = {};

    // Act
    patchStencilRegistryUrls(libraries, 'http://localhost:8080');

    // Assert
    expect(libraries).toEqual({});
  });

  it('should handle an empty url array', () => {
    // Arrange
    const libraries: Record<string, string[]> = { basic: [] };

    // Act
    patchStencilRegistryUrls(libraries, 'http://localhost:8080');

    // Assert
    expect(libraries.basic).toEqual([]);
  });

  it('should skip non-string entries defensively', () => {
    // Arrange — simulates an unexpected runtime value from the third-party script
    const libraries = {
      basic: ['https://viewer.diagrams.net/shapes/a.xml', null, undefined, 123],
    } as unknown as Record<string, string[]>;

    // Act
    patchStencilRegistryUrls(libraries, 'http://localhost:8080');

    // Assert
    expect(libraries.basic).toEqual([
      'http://localhost:8080/shapes/a.xml',
      null,
      undefined,
      123,
    ]);
  });

  it('should support custom origins with ports and paths', () => {
    // Arrange
    const libraries: Record<string, string[]> = {
      basic: ['https://viewer.diagrams.net/shapes/basic/cube.xml'],
    };

    // Act
    patchStencilRegistryUrls(libraries, 'https://drawio.example.com:8443');

    // Assert
    expect(libraries.basic).toEqual([
      'https://drawio.example.com:8443/shapes/basic/cube.xml',
    ]);
  });
});
