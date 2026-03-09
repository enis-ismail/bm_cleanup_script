import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { startTimer } from '../../src/helpers/timer.js';

// ============================================================================
// startTimer
// ============================================================================

describe('startTimer', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('returns a timer object with expected properties', () => {
        const timer = startTimer();

        expect(timer).toHaveProperty('startTime');
        expect(timer).toHaveProperty('endTime', null);
        expect(timer).toHaveProperty('checkpoints');
        expect(timer.checkpoints).toEqual([]);
        expect(typeof timer.addCheckpoint).toBe('function');
        expect(typeof timer.getElapsed).toBe('function');
        expect(typeof timer.formatElapsed).toBe('function');
        expect(typeof timer.stop).toBe('function');
    });

    it('records startTime as current time', () => {
        const now = Date.now();
        const timer = startTimer();

        expect(timer.startTime).toBe(now);
    });

    // ========================================================================
    // addCheckpoint
    // ========================================================================

    it('adds a checkpoint with label and elapsed time', () => {
        const timer = startTimer();

        vi.advanceTimersByTime(500);
        const elapsed = timer.addCheckpoint('step1');

        expect(elapsed).toBe(500);
        expect(timer.checkpoints).toHaveLength(1);
        expect(timer.checkpoints[0]).toEqual({ label: 'step1', elapsed: 500 });
    });

    it('accumulates multiple checkpoints', () => {
        const timer = startTimer();

        vi.advanceTimersByTime(100);
        timer.addCheckpoint('first');

        vi.advanceTimersByTime(200);
        timer.addCheckpoint('second');

        expect(timer.checkpoints).toHaveLength(2);
        expect(timer.checkpoints[0]).toEqual({ label: 'first', elapsed: 100 });
        expect(timer.checkpoints[1]).toEqual({ label: 'second', elapsed: 300 });
    });

    // ========================================================================
    // getElapsed
    // ========================================================================

    it('returns elapsed time while timer is running', () => {
        const timer = startTimer();

        vi.advanceTimersByTime(2000);
        expect(timer.getElapsed()).toBe(2000);

        vi.advanceTimersByTime(3000);
        expect(timer.getElapsed()).toBe(5000);
    });

    it('returns frozen elapsed time after timer is stopped', () => {
        const timer = startTimer();

        vi.advanceTimersByTime(2000);
        timer.stop();

        vi.advanceTimersByTime(5000);
        expect(timer.getElapsed()).toBe(2000);
    });

    // ========================================================================
    // formatElapsed
    // ========================================================================

    it('formats seconds only when under one minute', () => {
        const timer = startTimer();

        vi.advanceTimersByTime(15000);
        expect(timer.formatElapsed()).toBe('15s');
    });

    it('formats minutes and seconds when over one minute', () => {
        const timer = startTimer();

        vi.advanceTimersByTime(125000); // 2m 5s
        expect(timer.formatElapsed()).toBe('2m 5s');
    });

    it('formats exactly one minute', () => {
        const timer = startTimer();

        vi.advanceTimersByTime(60000);
        expect(timer.formatElapsed()).toBe('1m 0s');
    });

    it('formats zero seconds for immediate call', () => {
        const timer = startTimer();
        expect(timer.formatElapsed()).toBe('0s');
    });

    it('rounds to nearest second', () => {
        const timer = startTimer();

        vi.advanceTimersByTime(1499); // rounds to 1s
        expect(timer.formatElapsed()).toBe('1s');
    });

    // ========================================================================
    // stop
    // ========================================================================

    it('sets endTime and returns formatted elapsed', () => {
        const timer = startTimer();

        vi.advanceTimersByTime(3000);
        const result = timer.stop();

        expect(timer.endTime).not.toBeNull();
        expect(result).toBe('3s');
    });

    it('freezes elapsed time upon stopping', () => {
        const timer = startTimer();

        vi.advanceTimersByTime(10000);
        timer.stop();

        const elapsedAfterStop = timer.getElapsed();
        vi.advanceTimersByTime(5000);

        expect(timer.getElapsed()).toBe(elapsedAfterStop);
    });
});
