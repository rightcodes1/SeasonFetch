export async function copyTextToClipboard(text, {
  clipboard = globalThis.navigator?.clipboard,
  documentRef = globalThis.document
} = {}) {
  if (typeof text !== 'string' || !text) throw new Error('There is nothing to copy.');

  let clipboardError = null;
  if (clipboard && typeof clipboard.writeText === 'function') {
    try {
      await clipboard.writeText(text);
      return;
    } catch (error) {
      clipboardError = error;
    }
  }

  if (documentRef?.createElement && documentRef.body?.appendChild && typeof documentRef.execCommand === 'function') {
    let field;
    try {
      field = documentRef.createElement('textarea');
      field.value = text;
      field.setAttribute('readonly', '');
      field.style.position = 'fixed';
      field.style.opacity = '0';
      documentRef.body.appendChild(field);
      field.select();
      if (documentRef.execCommand('copy')) return;
    } catch (error) {
      clipboardError ||= error;
    } finally {
      field?.remove();
    }
  }

  const message = clipboardError
    ? `Clipboard access failed${clipboardError.message ? `: ${clipboardError.message}` : ''}. Allow clipboard access or copy the link manually.`
    : 'Clipboard access is unavailable in this browser. Copy the link manually.';
  const error = new Error(message);
  if (clipboardError) error.cause = clipboardError;
  throw error;
}
