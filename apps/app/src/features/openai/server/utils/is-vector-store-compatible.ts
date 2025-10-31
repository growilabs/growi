import path from 'path';

// See: https://platform.openai.com/docs/assistants/tools/file-search#supported-files
const supportedFormats = {
  '.c': 'text/x-c',
  '.cpp': 'text/x-c++',
  '.cs': 'text/x-csharp',
  '.css': 'text/css',
  '.doc': 'application/msword',
  '.docx':
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.go': 'text/x-golang',
  '.html': 'text/html',
  '.java': 'text/x-java',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.php': 'text/x-php',
  '.pptx':
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.py': ['text/x-python', 'text/x-script.python'],
  '.rb': 'text/x-ruby',
  '.sh': 'application/x-sh',
  '.tex': 'text/x-tex',
  '.ts': 'application/typescript',
  '.txt': 'text/plain',
} as const;

type SupportedExtension = keyof typeof supportedFormats;

export const isVectorStoreCompatible = (
  originalName: string,
  mimeType: string,
): boolean => {
  // Get extension
  const extension = path.extname(originalName).toLowerCase();

  // Check if the file extension is supported
  if (!(extension in supportedFormats)) {
    return false;
  }

  // Get Mime Type (At this point, file extension is confirmed to be supported, so type-safe access is possible)
  const supportedMimeType = supportedFormats[extension as SupportedExtension];

  // Check if the mimeType is supported
  return Array.isArray(supportedMimeType)
    ? supportedMimeType.includes(mimeType)
    : supportedMimeType === mimeType;
};
