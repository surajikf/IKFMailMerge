import { describe, it, expect } from 'vitest';
import {
  getSendPreconditionFailure,
  listUnresolvedMergeTags,
  normalizeMergeTagKey,
} from './mailmergeGuards';

describe('getSendPreconditionFailure (negative paths)', () => {
  it('fails when batchId is null', () => {
    expect(
      getSendPreconditionFailure({ batchId: null, sampleDataLength: 5, scheduledFor: '' })
    ).toBe('missing_batch');
  });

  it('fails when there are no sample rows', () => {
    expect(
      getSendPreconditionFailure({ batchId: 'b1', sampleDataLength: 0, scheduledFor: '' })
    ).toBe('no_rows');
  });

  it('fails when scheduledFor is non-empty but not a valid date', () => {
    expect(
      getSendPreconditionFailure({ batchId: 'b1', sampleDataLength: 1, scheduledFor: 'not-a-date' })
    ).toBe('invalid_schedule');
  });

  it('allows empty schedule (send ASAP)', () => {
    expect(
      getSendPreconditionFailure({ batchId: 'b1', sampleDataLength: 3, scheduledFor: '' })
    ).toBeNull();
  });

  it('allows whitespace-only schedule as ASAP (no validation)', () => {
    expect(
      getSendPreconditionFailure({ batchId: 'b1', sampleDataLength: 1, scheduledFor: '   ' })
    ).toBeNull();
  });

  it('passes with valid ISO-like local datetime string', () => {
    expect(
      getSendPreconditionFailure({
        batchId: 'b1',
        sampleDataLength: 1,
        scheduledFor: '2026-12-31T09:00',
      })
    ).toBeNull();
  });
});

describe('listUnresolvedMergeTags (negative paths)', () => {
  const cols = ['Client Name', 'Email Address', 'Amount Due'];

  it('returns unknown tag not in columns', () => {
    expect(listUnresolvedMergeTags('Hello {{ Mystery Field }}', cols)).toContain('Mystery Field');
  });

  it('returns empty when all tags match columns (case / spacing tolerant)', () => {
    expect(listUnresolvedMergeTags('{{ client name }} {{EMAIL ADDRESS}}', cols)).toEqual([]);
  });

  it('treats underscore vs space as same key', () => {
    expect(listUnresolvedMergeTags('{{ Client_Name }}', cols)).toEqual([]);
  });

  it('flags multiple unknown tags uniquely', () => {
    const u = listUnresolvedMergeTags('{{a}} {{b}} {{a}}', cols);
    expect(u.sort()).toEqual(['a', 'b'].sort());
  });

  it('handles empty text', () => {
    expect(listUnresolvedMergeTags('', cols)).toEqual([]);
  });

  it('handles no placeholders', () => {
    expect(listUnresolvedMergeTags('Plain text only', cols)).toEqual([]);
  });
});

describe('normalizeMergeTagKey', () => {
  it('normalizes casing and spacing', () => {
    expect(normalizeMergeTagKey('  Email   ADDRESS ')).toBe('email address');
  });
});
