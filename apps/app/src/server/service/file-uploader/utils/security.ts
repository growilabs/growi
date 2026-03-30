export const defaultContentDispositionSettings: Record<
  string,
  'inline' | 'attachment'
> = {
  // Image Types
  'image/jpeg': 'inline',
  'image/png': 'inline',
  'image/gif': 'inline',
  'image/webp': 'inline',
  'image/bmp': 'inline',
  'image/tiff': 'inline',
  'image/x-icon': 'inline',

  // Document & Media Types
  'application/pdf': 'inline',
  'text/plain': 'inline',
  'video/mp4': 'inline',
  'video/webm': 'inline',
  'video/ogg': 'inline',
  'audio/mpeg': 'inline',
  'audio/ogg': 'inline',
  'audio/wav': 'inline',

  // Potentially Dangerous / Executable / Scriptable Types
  'text/html': 'attachment',
  'text/javascript': 'attachment',
  'application/javascript': 'attachment',
  'image/svg+xml': 'attachment',
  'application/xml': 'attachment',
  'application/json': 'attachment',
  'application/x-sh': 'attachment',
  'application/x-msdownload': 'attachment',
  'application/octet-stream': 'attachment',

  // Other Common Document Formats
  'application/msword': 'attachment',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
    'attachment',
  'application/vnd.ms-excel': 'attachment',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':
    'attachment',
  'application/vnd.ms-powerpoint': 'attachment',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation':
    'attachment',
  'application/zip': 'attachment',
  'application/x-rar-compressed': 'attachment',
  'text/csv': 'attachment',
};
