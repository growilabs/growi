import { generalXssFilter } from './general-xss-filter';

describe('generalXssFilter', () => {

  test('should be sanitize script tag', () => {
    // Act
    const result = generalXssFilter.process('<script>alert("XSS")</script>');

    // Assert
    expect(result).toBe('alert("XSS")');
  });

  test('should be sanitize nested script tag recursively', () => {
    // Act
    const result = generalXssFilter.process('<scr<script>ipt>alert("XSS")</scr<script>ipt>');

    // Assert
    expect(result).toBe('alert("XSS")');
  });

  // for https://github.com/growilabs/growi/issues/221
  test('should not be sanitize blockquote', () => {
    // Act
    const result = generalXssFilter.process('> foo\n> bar');

    // Assert
    expect(result).toBe('> foo\n> bar');
  });

  // https://github.com/growilabs/growi/pull/505
  test('should not be sanitize next closing-tag', () => {
    // Act
    const result = generalXssFilter.process('<evil /><span>text</span>');

    // Assert
    expect(result).toBe('<span>text</span>');
  });

});
