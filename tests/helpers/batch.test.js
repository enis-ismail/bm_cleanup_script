import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { processBatch, withLoadShedding } from '../../src/helpers/batch.js';

// ============================================================================
// processBatch
// ============================================================================

describe('processBatch', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns empty array for empty items', async () => {
        const result = await processBatch([], vi.fn());
        expect(result).toEqual([]);
    });

    it('processes all items and returns results', async () => {
        const items = [1, 2, 3];
        const processFn = vi.fn(async (item) => item * 2);

        const result = await processBatch(items, processFn);

        expect(result).toEqual([2, 4, 6]);
        expect(processFn).toHaveBeenCalledTimes(3);
    });

    it('respects batchSize for parallel execution', async () => {
        const callOrder = [];
        const items = [1, 2, 3, 4, 5];
        const processFn = vi.fn(async (item) => {
            callOrder.push(item);
            return item;
        });

        const result = await processBatch(items, processFn, 2);

        expect(result).toEqual([1, 2, 3, 4, 5]);
        expect(processFn).toHaveBeenCalledTimes(5);
    });

    it('calls onProgress callback with progress info', async () => {
        const items = ['a', 'b', 'c'];
        const processFn = vi.fn(async (item) => item.toUpperCase());
        const onProgress = vi.fn();

        await processBatch(items, processFn, 2, onProgress);

        expect(onProgress).toHaveBeenCalled();
        // First batch of 2 items
        expect(onProgress).toHaveBeenCalledWith(
            2,
            3,
            expect.any(Number)
        );
        // Second batch completes remaining
        expect(onProgress).toHaveBeenCalledWith(
            3,
            3,
            expect.any(Number)
        );
    });

    it('filters out null results from failed items', async () => {
        const items = [1, 2, 3];
        const processFn = vi.fn(async (item) => {
            if (item === 2) {
                throw new Error('fail');
            }
            return item;
        });

        const result = await processBatch(items, processFn, 3, null, 0, { maxRetries: 0 });

        expect(result).toEqual([1, 3]);
    });

    it('retries failed items up to maxRetries', async () => {
        let attempts = 0;
        const processFn = vi.fn(async () => {
            attempts++;
            if (attempts <= 2) {
                throw new Error('temporary failure');
            }
            return 'success';
        });

        const result = await processBatch(
            ['item'],
            processFn,
            1,
            null,
            0,
            { maxRetries: 3, initialDelay: 1 }
        );

        expect(result).toEqual(['success']);
    });

    it('returns null for items that fail all retries', async () => {
        const processFn = vi.fn(async () => {
            throw new Error('permanent failure');
        });

        const result = await processBatch(
            ['item'],
            processFn,
            1,
            null,
            0,
            { maxRetries: 1, initialDelay: 1 }
        );

        expect(result).toEqual([]);
    });

    it('does not retry for non-retryable HTTP status codes', async () => {
        const processFn = vi.fn(async () => {
            const error = new Error('Not Found');
            error.response = { status: 404 };
            throw error;
        });

        const result = await processBatch(
            ['item'],
            processFn,
            1,
            null,
            0,
            { maxRetries: 3, initialDelay: 1 }
        );

        expect(result).toEqual([]);
        expect(processFn).toHaveBeenCalledTimes(1);
    });

    it('retries for retryable HTTP status codes', async () => {
        let attempts = 0;
        const processFn = vi.fn(async () => {
            attempts++;
            if (attempts <= 1) {
                const error = new Error('Too Many Requests');
                error.response = { status: 429 };
                throw error;
            }
            return 'ok';
        });

        const result = await processBatch(
            ['item'],
            processFn,
            1,
            null,
            0,
            { maxRetries: 3, initialDelay: 1 }
        );

        expect(result).toEqual(['ok']);
    });

    it('adds delay between batches when delayMs is specified', async () => {
        const items = [1, 2, 3, 4];
        const processFn = vi.fn(async (item) => item);
        const startTime = Date.now();

        await processBatch(items, processFn, 2, null, 50);

        const elapsed = Date.now() - startTime;
        // Should have at least one delay of ~50ms between the two batches
        expect(elapsed).toBeGreaterThanOrEqual(40);
    });

    it('does not add delay after the last batch', async () => {
        const items = [1, 2];
        const processFn = vi.fn(async (item) => item);
        const startTime = Date.now();

        await processBatch(items, processFn, 2, null, 500);

        const elapsed = Date.now() - startTime;
        // Only one batch, so no delay should be applied
        expect(elapsed).toBeLessThan(400);
    });

    it('uses default batchSize of 10', async () => {
        const items = Array.from({ length: 15 }, (_, i) => i);
        const processFn = vi.fn(async (item) => item);

        const result = await processBatch(items, processFn);

        expect(result).toHaveLength(15);
    });
});

// ============================================================================
// withLoadShedding
// ============================================================================

describe('withLoadShedding', () => {
    beforeEach(() => {
        vi.spyOn(console, 'log').mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns result on first success', async () => {
        const fn = vi.fn(async () => 'ok');
        const result = await withLoadShedding(fn);
        expect(result).toBe('ok');
        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on retryable status codes and succeeds', async () => {
        let callCount = 0;
        const fn = vi.fn(async () => {
            callCount++;
            if (callCount <= 1) {
                const error = new Error('Too Many Requests');
                error.response = { status: 429 };
                throw error;
            }
            return 'recovered';
        });

        const result = await withLoadShedding(fn, {
            maxRetries: 3,
            initialDelay: 1
        });

        expect(result).toBe('recovered');
        expect(fn).toHaveBeenCalledTimes(2);
    });

    it('throws original error after exhausting retries', async () => {
        const fn = vi.fn(async () => {
            const error = new Error('Service Unavailable');
            error.response = { status: 503 };
            throw error;
        });

        await expect(withLoadShedding(fn, {
            maxRetries: 2,
            initialDelay: 1
        })).rejects.toThrow('Service Unavailable');

        expect(fn).toHaveBeenCalledTimes(3); // initial + 2 retries
    });

    it('does not retry for non-retryable status codes', async () => {
        const fn = vi.fn(async () => {
            const error = new Error('Bad Request');
            error.response = { status: 400 };
            throw error;
        });

        await expect(withLoadShedding(fn, {
            maxRetries: 3,
            initialDelay: 1
        })).rejects.toThrow('Bad Request');

        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries on network errors without status code', async () => {
        let callCount = 0;
        const fn = vi.fn(async () => {
            callCount++;
            if (callCount <= 1) {
                const error = new Error('ECONNRESET');
                error.code = 'ECONNRESET';
                throw error;
            }
            return 'recovered';
        });

        const result = await withLoadShedding(fn, {
            maxRetries: 3,
            initialDelay: 1
        });

        expect(result).toBe('recovered');
    });

    it('does not retry ENOTFOUND errors', async () => {
        const fn = vi.fn(async () => {
            const error = new Error('ENOTFOUND');
            error.code = 'ENOTFOUND';
            throw error;
        });

        await expect(withLoadShedding(fn, {
            maxRetries: 3,
            initialDelay: 1
        })).rejects.toThrow('ENOTFOUND');

        expect(fn).toHaveBeenCalledTimes(1);
    });

    it('calls onRetry callback when retrying', async () => {
        let callCount = 0;
        const fn = vi.fn(async () => {
            callCount++;
            if (callCount <= 2) {
                const error = new Error('Rate limited');
                error.response = { status: 429 };
                throw error;
            }
            return 'ok';
        });

        const onRetry = vi.fn();

        await withLoadShedding(fn, {
            maxRetries: 3,
            initialDelay: 1,
            onRetry
        });

        expect(onRetry).toHaveBeenCalledTimes(2);
        expect(onRetry).toHaveBeenCalledWith(
            1,
            expect.any(Number),
            expect.any(Error)
        );
        expect(onRetry).toHaveBeenCalledWith(
            2,
            expect.any(Number),
            expect.any(Error)
        );
    });

    it('uses exponential backoff by default', async () => {
        let callCount = 0;
        const fn = vi.fn(async () => {
            callCount++;
            if (callCount <= 2) {
                const error = new Error('Rate limited');
                error.response = { status: 429 };
                throw error;
            }
            return 'ok';
        });

        const delays = [];
        const onRetry = vi.fn((attempt, delay) => {
            delays.push(delay);
        });

        await withLoadShedding(fn, {
            maxRetries: 3,
            initialDelay: 100,
            onRetry
        });

        // First delay: 100, second delay: 200 (exponential)
        expect(delays[0]).toBe(100);
        expect(delays[1]).toBe(200);
    });

    it('uses fixed delay when exponential is false', async () => {
        let callCount = 0;
        const fn = vi.fn(async () => {
            callCount++;
            if (callCount <= 2) {
                const error = new Error('Rate limited');
                error.response = { status: 429 };
                throw error;
            }
            return 'ok';
        });

        const delays = [];
        const onRetry = vi.fn((attempt, delay) => {
            delays.push(delay);
        });

        await withLoadShedding(fn, {
            maxRetries: 3,
            initialDelay: 100,
            exponential: false,
            onRetry
        });

        // Both delays should be the same (fixed)
        expect(delays[0]).toBe(100);
        expect(delays[1]).toBe(100);
    });

    it('caps delay at maxDelay', async () => {
        let callCount = 0;
        const fn = vi.fn(async () => {
            callCount++;
            if (callCount <= 1) {
                const error = new Error('Rate limited');
                error.response = { status: 429 };
                throw error;
            }
            return 'ok';
        });

        const delays = [];
        const onRetry = vi.fn((attempt, delay) => {
            delays.push(delay);
        });

        await withLoadShedding(fn, {
            maxRetries: 3,
            initialDelay: 50000,
            maxDelay: 100,
            onRetry
        });

        expect(delays[0]).toBeLessThanOrEqual(100);
    });

    it('retries on custom retryableStatuses', async () => {
        let callCount = 0;
        const fn = vi.fn(async () => {
            callCount++;
            if (callCount <= 1) {
                const error = new Error('Custom status');
                error.response = { status: 529 };
                throw error;
            }
            return 'ok';
        });

        const result = await withLoadShedding(fn, {
            maxRetries: 3,
            initialDelay: 1,
            retryableStatuses: [529]
        });

        expect(result).toBe('ok');
    });

    it('uses default options when none provided', async () => {
        const fn = vi.fn(async () => 'default-test');
        const result = await withLoadShedding(fn);
        expect(result).toBe('default-test');
    });
});
