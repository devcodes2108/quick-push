import type { Language } from './types';

export const languageExtensions: Record<Language, string> = {
  Python: '.py', JavaScript: '.js', TypeScript: '.ts', Java: '.java', C: '.c', 'C++': '.cpp',
  'C#': '.cs', Go: '.go', Rust: '.rs', PHP: '.php', Ruby: '.rb', Kotlin: '.kt', Swift: '.swift',
  HTML: '.html', CSS: '.css', SQL: '.sql', 'Plain text': '.txt'
};

const forbiddenFilenameCharacters = /[\\/\0<>:"|?*]/;

export function validateFilename(filename: string): string | undefined {
  const trimmed = filename.trim();
  if (!trimmed) return 'Enter a filename.';
  if (trimmed === '.' || trimmed === '..') return 'Filename cannot contain path traversal.';
  if (forbiddenFilenameCharacters.test(trimmed)) return 'Use a single filename without slashes or reserved characters.';
  if (trimmed.length > 255) return 'Filename must be 255 characters or fewer.';
  if (/\s$/.test(filename)) return 'Filename cannot end with whitespace.';
  return undefined;
}

export function extensionFor(language: Language): string {
  return languageExtensions[language];
}

export function withLanguageExtension(filename: string, extension: string): string {
  const trimmed = filename.trim();
  if (!trimmed) return `solution-001${extension}`;
  const lastDot = trimmed.lastIndexOf('.');
  return `${lastDot > 0 ? trimmed.slice(0, lastDot) : trimmed}${extension}`;
}

export function suggestFilename(paths: string[], extension: string): string {
  const existing = new Set(paths.map((path) => path.split('/').pop()?.toLowerCase()));
  for (let index = 1; index < 10000; index += 1) {
    const candidate = `solution-${String(index).padStart(3, '0')}${extension}`;
    if (!existing.has(candidate.toLowerCase())) return candidate;
  }
  return `solution-${Date.now()}${extension}`;
}
