import { describe, it, expect } from 'vitest';
import {
  PROJECT_STATUSES,
  PROJECT_STATUS_BUCKETS,
  BUCKET_CANONICAL_STATUS,
  statusBucket,
  isProjectStatusBucket,
  coverCropSquare,
} from './shared';

describe('statusBucket', () => {
  it('collapses the 5 statuses into the 3 buckets', () => {
    expect(statusBucket('IDEA')).toBe('PLANNED');
    expect(statusBucket('PLANNING')).toBe('PLANNED');
    expect(statusBucket('IN_PROGRESS')).toBe('DOING');
    expect(statusBucket('TESTING')).toBe('DOING');
    expect(statusBucket('COMPLETED')).toBe('DONE');
  });

  it('maps every status to a known bucket', () => {
    for (const status of PROJECT_STATUSES) {
      expect(PROJECT_STATUS_BUCKETS).toContain(statusBucket(status));
    }
  });

  it('round-trips each bucket through its canonical status', () => {
    for (const bucket of PROJECT_STATUS_BUCKETS) {
      expect(statusBucket(BUCKET_CANONICAL_STATUS[bucket])).toBe(bucket);
    }
  });

  it('keeps the canonical statuses inside the real status set', () => {
    for (const bucket of PROJECT_STATUS_BUCKETS) {
      expect(PROJECT_STATUSES).toContain(BUCKET_CANONICAL_STATUS[bucket]);
    }
  });
});

describe('isProjectStatusBucket', () => {
  it('accepts bucket names and rejects raw statuses and noise', () => {
    for (const bucket of PROJECT_STATUS_BUCKETS) {
      expect(isProjectStatusBucket(bucket)).toBe(true);
    }
    expect(isProjectStatusBucket('IN_PROGRESS')).toBe(false);
    expect(isProjectStatusBucket('')).toBe(false);
  });
});

describe('coverCropSquare', () => {
  it('crops a landscape image horizontally, centered', () => {
    expect(coverCropSquare(400, 200)).toEqual({ sx: 100, sy: 0, size: 200 });
  });

  it('crops a portrait image vertically, centered', () => {
    expect(coverCropSquare(200, 400)).toEqual({ sx: 0, sy: 100, size: 200 });
  });

  it('keeps a square image whole', () => {
    expect(coverCropSquare(300, 300)).toEqual({ sx: 0, sy: 0, size: 300 });
  });

  it('never returns a degenerate rect for zero-sized input', () => {
    const rect = coverCropSquare(0, 0);
    expect(rect.size).toBeGreaterThan(0);
    expect(rect.sx).toBe(0);
    expect(rect.sy).toBe(0);
  });
});
