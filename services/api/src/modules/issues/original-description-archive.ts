/** locked_fields marker: original description was snapshotted to a comment. */
export const ORIGINAL_DESCRIPTION_PRESERVED_MARKER = 'original_description_preserved';

export function buildOriginalDescriptionArchiveComment(originalHtml: string): string {
  return `<p><strong>Original description (archived on first edit):</strong></p>${originalHtml}`;
}

export function shouldArchiveOriginalDescription(
  previousDescription: string | null | undefined,
  nextDescription: string | null | undefined,
  lockedFields: string[] | null | undefined,
): boolean {
  if (nextDescription === undefined) {
    return false;
  }
  if (String(nextDescription ?? '') === String(previousDescription ?? '')) {
    return false;
  }
  if (!previousDescription?.trim()) {
    return false;
  }
  return !(lockedFields ?? []).includes(ORIGINAL_DESCRIPTION_PRESERVED_MARKER);
}
