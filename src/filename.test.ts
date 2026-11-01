import { describe, expect, it } from 'vitest';
import { extensionFor, suggestFilename, validateFilename, withLanguageExtension } from './filename';

describe('filenames', () => {
  it('rejects paths and reserved characters', () => {
    expect(validateFilename('../answer.py')).toBeTruthy();
    expect(validateFilename('folder/answer.py')).toBeTruthy();
    expect(validateFilename('answer?.py')).toBeTruthy();
    expect(validateFilename('answer.py')).toBeUndefined();
    expect(validateFilename('version..py')).toBeUndefined();
  });
  it('maps languages and changes a generated extension predictably', () => {
    expect(extensionFor('Python')).toBe('.py');
    expect(extensionFor('C++')).toBe('.cpp');
    expect(withLanguageExtension('solution-001.py', '.ts')).toBe('solution-001.ts');
  });
  it('finds the first unused sequential solution filename', () => {
    expect(suggestFilename(['solution-001.py', 'nested/solution-002.py'], '.py')).toBe('solution-003.py');
  });
});
