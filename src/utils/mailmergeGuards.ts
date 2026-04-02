/**
 * Pure helpers for send preconditions and merge-tag checks.
 * Used by FileUpload and covered by Vitest negative tests.
 */

export type SendPreconditionInput = {
  batchId: string | null;
  sampleDataLength: number;
  /** Local datetime-local value or ''; empty means send ASAP */
  scheduledFor: string;
};

export type SendPreconditionFailure = 'missing_batch' | 'no_rows' | 'invalid_schedule';

export function getSendPreconditionFailure(input: SendPreconditionInput): SendPreconditionFailure | null {
  if (!input.batchId) return 'missing_batch';
  if (input.sampleDataLength === 0) return 'no_rows';
  if (input.scheduledFor?.trim()) {
    const d = new Date(input.scheduledFor);
    if (Number.isNaN(d.getTime())) return 'invalid_schedule';
  }
  return null;
}

export function normalizeMergeTagKey(value: string): string {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ');
}

/** Tags like {{ Column Name }} that are not present in columnNames (after normalization). */
export function listUnresolvedMergeTags(text: string, columnNames: string[]): string[] {
  const matches = [...String(text || '').matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)];
  if (!matches.length) return [];
  const known = new Set(columnNames.map((c) => normalizeMergeTagKey(c)));
  return [
    ...new Set(
      matches
        .map((m) => (m[1] || '').trim())
        .filter(Boolean)
        .filter((tag) => !known.has(normalizeMergeTagKey(tag)))
    ),
  ];
}
