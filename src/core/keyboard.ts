/**
 * AirBrowse - Virtual Keyboard Injection Module
 * Simulates real-time character typing into active DOM elements (<input>, <textarea>, contenteditable).
 * Provides full compatibility with React, Vue, and Angular controlled inputs via native property setters.
 */

/**
 * Resolves the deeply focused element, descending into open Shadow DOMs if present.
 */
export function getActiveElement(): Element | null {
  if (typeof document === 'undefined') return null;

  let activeEl = document.activeElement;
  while (activeEl && activeEl.shadowRoot && activeEl.shadowRoot.activeElement) {
    activeEl = activeEl.shadowRoot.activeElement;
  }
  return activeEl;
}

/**
 * Injects a single character or string into the currently focused DOM input element.
 * Dispatches W3C standard beforeinput, input, and change events for framework synchronization.
 *
 * @param char The character to type (e.g., 'A', 'B', etc.)
 * @returns boolean indicating whether a valid active input received the character
 */
export function typeCharacter(char: string): boolean {
  if (!char || typeof document === 'undefined') {
    return false;
  }

  const active = getActiveElement();
  if (!active) {
    return false;
  }

  // 1. Handle HTMLInputElement & HTMLTextAreaElement
  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    // Avoid injecting into non-text input types (checkboxes, radio buttons, file pickers)
    if (active instanceof HTMLInputElement) {
      const nonTextTypes = ['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'color', 'range'];
      if (nonTextTypes.includes(active.type)) {
        return false;
      }
    }

    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? active.value.length;
    const currentVal = active.value;
    const nextVal = currentVal.slice(0, start) + char + currentVal.slice(end);

    // Call native setter to bypass React 16+ controlled input tracker override
    const prototype =
      active instanceof HTMLInputElement
        ? window.HTMLInputElement.prototype
        : window.HTMLTextAreaElement.prototype;

    const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(active, nextVal);
    } else {
      active.value = nextVal;
    }

    // Advance cursor caret position
    try {
      active.setSelectionRange(start + char.length, start + char.length);
    } catch {
      // Some input types (e.g., email, number) throw on setSelectionRange
    }

    // Dispatch standard input events
    active.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        composed: true,
        data: char,
        inputType: 'insertText',
      })
    );

    active.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        data: char,
        inputType: 'insertText',
      })
    );

    active.dispatchEvent(new Event('change', { bubbles: true, composed: true }));

    return true;
  }

  // 2. Handle Rich Text / contenteditable elements (Notion, Slack, Gmail, etc.)
  if (active instanceof HTMLElement && active.isContentEditable) {
    const success = document.execCommand('insertText', false, char);
    if (!success) {
      // Fallback: append text node if execCommand is restricted
      const selection = window.getSelection();
      if (selection && selection.rangeCount > 0) {
        const range = selection.getRangeAt(0);
        range.deleteContents();
        const textNode = document.createTextNode(char);
        range.insertNode(textNode);
        range.setStartAfter(textNode);
        range.setEndAfter(textNode);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }

    active.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        data: char,
        inputType: 'insertText',
      })
    );
    return true;
  }

  return false;
}

/**
 * Handles backspace deletion in active input or contenteditable.
 */
export function backspaceCharacter(): boolean {
  if (typeof document === 'undefined') return false;

  const active = getActiveElement();
  if (!active) return false;

  if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement) {
    const start = active.selectionStart ?? active.value.length;
    const end = active.selectionEnd ?? active.value.length;
    const currentVal = active.value;

    let nextVal = '';
    let nextPos = start;

    if (start !== end) {
      nextVal = currentVal.slice(0, start) + currentVal.slice(end);
      nextPos = start;
    } else if (start > 0) {
      nextVal = currentVal.slice(0, start - 1) + currentVal.slice(end);
      nextPos = start - 1;
    } else {
      return false;
    }

    const prototype =
      active instanceof HTMLInputElement
        ? window.HTMLInputElement.prototype
        : window.HTMLTextAreaElement.prototype;

    const nativeSetter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
    if (nativeSetter) {
      nativeSetter.call(active, nextVal);
    } else {
      active.value = nextVal;
    }

    try {
      active.setSelectionRange(nextPos, nextPos);
    } catch {}

    active.dispatchEvent(
      new InputEvent('beforeinput', {
        bubbles: true,
        cancelable: true,
        composed: true,
        inputType: 'deleteContentBackward',
      })
    );

    active.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'deleteContentBackward',
      })
    );

    active.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
    return true;
  }

  if (active instanceof HTMLElement && active.isContentEditable) {
    document.execCommand('delete', false);
    active.dispatchEvent(
      new InputEvent('input', {
        bubbles: true,
        composed: true,
        inputType: 'deleteContentBackward',
      })
    );
    return true;
  }

  return false;
}

/**
 * Inserts a newline or dispatches Enter key event.
 */
export function insertNewline(): boolean {
  if (typeof document === 'undefined') return false;

  const active = getActiveElement();
  if (!active) return false;

  if (active instanceof HTMLTextAreaElement) {
    return typeCharacter('\n');
  }

  if (active instanceof HTMLInputElement) {
    const enterEventInit: KeyboardEventInit = {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      composed: true,
    };
    active.dispatchEvent(new KeyboardEvent('keydown', enterEventInit));
    active.dispatchEvent(new KeyboardEvent('keypress', enterEventInit));
    active.dispatchEvent(new KeyboardEvent('keyup', enterEventInit));
    if (active.form) {
      active.form.requestSubmit();
    }
    return true;
  }

  if (active instanceof HTMLElement && active.isContentEditable) {
    document.execCommand('insertParagraph', false);
    return true;
  }

  return false;
}
