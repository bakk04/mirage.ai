/**
 * AirBrowse - Gemini API Integration Module
 * Securely communicates with the Gemini REST API inside the background service worker.
 */

import { DEFAULT_GEMINI_MODEL } from '../core/config';

export interface GeminiPart {
  text: string;
}

export interface GeminiContent {
  parts: GeminiPart[];
  role?: string;
}

export interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
  index?: number;
}

export interface GeminiPromptFeedback {
  blockReason?: string;
}

export interface GeminiApiError {
  code: number;
  message: string;
  status: string;
}

export interface GeminiResponse {
  candidates?: GeminiCandidate[];
  promptFeedback?: GeminiPromptFeedback;
  error?: GeminiApiError;
}

/**
 * Builds the appropriate Gemini API endpoint URL based on model name.
 */
export function getGeminiEndpoint(model: string = DEFAULT_GEMINI_MODEL): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

/**
 * Sends extracted text to Gemini API to generate a concise summary.
 */
export async function summarizeText(
  text: string,
  apiKey?: string,
  modelName: string = DEFAULT_GEMINI_MODEL
): Promise<string> {
  const sanitizedKey = apiKey?.trim() ?? '';
  if (!sanitizedKey) {
    throw new Error('Gemini API key is required. Please set it in the extension popup.');
  }

  const sanitizedText = text.trim();
  if (!sanitizedText) {
    throw new Error('No readable text content found on this webpage to summarize.');
  }

  const prompt =
    'Summarize the following webpage content in 3-5 concise, bullet-pointed key takeaways:\n\n' +
    sanitizedText;

  const url = `${getGeminiEndpoint(modelName)}?key=${encodeURIComponent(sanitizedKey)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        contents: [
          {
            parts: [{ text: prompt }],
          },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
        },
      }),
      signal: controller.signal,
    });
  } catch (networkError: unknown) {
    if (networkError instanceof DOMException && networkError.name === 'AbortError') {
      throw new Error(
        'Gemini API request timed out after 15 seconds. Please check your connection or try again.'
      );
    }
    throw new Error(
      `Network error contacting Gemini API: ${
        networkError instanceof Error ? networkError.message : String(networkError)
      }`
    );
  } finally {
    clearTimeout(timeoutId);
  }

  const data: GeminiResponse = await response.json();

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(
        'Gemini API rate limit or quota exceeded (HTTP 429). Please wait a few seconds before retrying.'
      );
    }
    if (response.status === 400 || response.status === 403) {
      throw new Error(
        `Gemini API authorization failed (HTTP ${response.status}): ${data.error?.message || 'Invalid API key.'}`
      );
    }
    const errorDetail =
      data.error?.message || `HTTP ${response.status}: ${response.statusText}`;
    throw new Error(`Gemini API Error: ${errorDetail}`);
  }

  const candidate = data.candidates?.[0];
  const summary = candidate?.content?.parts?.[0]?.text;

  if (!summary) {
    if (data.promptFeedback?.blockReason) {
      throw new Error(`Summary blocked by safety filters (${data.promptFeedback.blockReason}).`);
    }
    throw new Error('Gemini API returned an empty response.');
  }

  return summary.trim();
}
