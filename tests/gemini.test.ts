import { describe, expect, it } from 'vitest';
import { getGeminiEndpoint, summarizeText } from '../src/background/gemini';

describe('Gemini integration', () => {
  it('uses the configured model endpoint', () => {
    expect(getGeminiEndpoint('gemini-test')).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-test:generateContent'
    );
  });

  it('requires an explicitly supplied API key', async () => {
    await expect(summarizeText('Readable page content', '')).rejects.toThrow(
      'Gemini API key is required'
    );
  });
});
