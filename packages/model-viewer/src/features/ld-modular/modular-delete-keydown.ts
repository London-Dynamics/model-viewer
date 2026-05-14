/**
 * Keyboard checks for LD Modular delete/backspace handling (internal to this package).
 * Host apps should mirror the same rules in their own listeners if needed; this module is not re-exported from the library entry.
 */

export function isModularDeleteOrBackspaceKey(event: KeyboardEvent): boolean {
  return event.key === 'Delete' || event.key === 'Backspace';
}

export function isModularDeleteKeydownEventTargetEditable(
  event: KeyboardEvent
): boolean {
  const target = event.target as EventTarget | null;
  const targetEl =
    target && (target as Node).nodeType === Node.ELEMENT_NODE
      ? (target as Element)
      : null;
  const tagName = targetEl?.tagName?.toLowerCase();
  return (
    tagName === 'input' ||
    tagName === 'textarea' ||
    !!targetEl?.closest('[contenteditable=""], [contenteditable="true"]')
  );
}

/**
 * When true, this keydown should not be treated as a modular delete shortcut
 * (wrong key, or user is typing in an editable field).
 */
export function shouldIgnoreModularDeleteKeydown(
  event: KeyboardEvent
): boolean {
  if (!isModularDeleteOrBackspaceKey(event)) return true;
  if (isModularDeleteKeydownEventTargetEditable(event)) return true;
  return false;
}
