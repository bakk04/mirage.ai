/**
 * AirBrowse - Content Extraction Module
 * Extracts the primary readable textual content of the active webpage for AI summarization.
 */

/**
 * Extracts and sanitizes the core text content of the current document.
 * Prioritizes semantic article/main blocks and structural headings/paragraphs to minimize token overhead.
 * Fallbacks to innerText and strictly limits output to maxChars.
 */
export function extractMainText(maxChars: number = 3000): string {
  try {
    // 1. Locate the most relevant semantic container
    const primaryContainer = document.querySelector(
      'article, main, [role="main"], #content, .content, .post-content, .article-content'
    );
    const root = primaryContainer ?? document.body;

    if (!root) {
      return '';
    }

    // 2. Query structural content elements (headings and paragraphs)
    const elements = root.querySelectorAll('h1, h2, h3, p');
    let extractedText = '';

    if (elements.length > 0) {
      const chunks: string[] = [];

      for (const el of Array.from(elements)) {
        // Exclude hidden elements or script/style containers
        if (el instanceof HTMLElement && el.offsetParent !== null) {
          const text = el.innerText.trim();
          if (text.length > 0) {
            chunks.push(text);
          }
        }
      }

      extractedText = chunks.join('\n\n');
    }

    // 3. Fallback to body innerText if semantic extraction yielded negligible content
    if (extractedText.length < 50 && document.body) {
      extractedText = document.body.innerText;
    }

    // 4. Sanitize excessive whitespace and empty lines
    const normalized = extractedText
      .replace(/\r\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]+/g, ' ')
      .trim();

    // 5. Cap output to maximum character length
    return normalized.slice(0, maxChars);
  } catch (error) {
    console.warn('[AirBrowse] Content extraction failed, falling back to body innerText:', error);
    return document.body ? document.body.innerText.slice(0, maxChars) : '';
  }
}
