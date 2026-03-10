import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
    getAnimatedDots,
    RealmProgressDisplay
} from '../../src/scripts/loggingScript/progressDisplay.js';

// ============================================================================
// Tests — getAnimatedDots
// ============================================================================

describe('getAnimatedDots', () => {
    it('returns one dot for frame 0', () => {
        expect(getAnimatedDots(0)).toBe('.');
    });

    it('returns two dots for frame 1', () => {
        expect(getAnimatedDots(1)).toBe('..');
    });

    it('returns three dots for frame 2', () => {
        expect(getAnimatedDots(2)).toBe('...');
    });

    it('cycles back to one dot on frame 3', () => {
        expect(getAnimatedDots(3)).toBe('.');
    });

    it('handles negative frame index', () => {
        expect(getAnimatedDots(-1)).toBe('.');
    });
});

// ============================================================================
// Tests — RealmProgressDisplay constructor & lifecycle
// ============================================================================

describe('RealmProgressDisplay', () => {
    let display;
    let writeSpy;

    beforeEach(() => {
        vi.useFakeTimers();
        writeSpy = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
        display = new RealmProgressDisplay(100);
    });

    afterEach(() => {
        // Ensure display is stopped to restore console
        if (display.isRunning) {
            display.stop();
        }
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    describe('constructor', () => {
        it('initializes with default state', () => {
            expect(display.isRunning).toBe(false);
            expect(display.realms.size).toBe(0);
            expect(display.renderedLineCount).toBe(0);
            expect(display.frameCount).toBe(0);
        });
    });

    describe('start', () => {
        it('sets isRunning to true', () => {
            display.start();
            expect(display.isRunning).toBe(true);
        });

        it('does not start twice', () => {
            display.start();
            display.start();
            expect(display.isRunning).toBe(true);
        });
    });

    describe('stop', () => {
        it('sets isRunning to false and renders final frame', () => {
            display.ensureRealm('host1', 'EU05');
            display.start();
            display.stop();
            expect(display.isRunning).toBe(false);
            // Should have written output (final frame)
            expect(writeSpy).toHaveBeenCalled();
        });
    });

    describe('finish', () => {
        it('marks all realms as completed', () => {
            display.ensureRealm('host1', 'EU05');
            display.ensureRealm('host2', 'APAC');
            display.start();

            display.startStep('host1', 'EU05', 'fetch', 'Fetching');
            display.startStep('host2', 'APAC', 'fetch', 'Fetching');

            display.finish();

            expect(display.isRunning).toBe(false);
            expect(display.realms.size).toBe(0); // cleared after finish
            expect(display.renderedLineCount).toBe(0);
        });
    });

    // ============================================================================
    // Realm management
    // ============================================================================

    describe('ensureRealm', () => {
        it('creates a new realm entry', () => {
            display.ensureRealm('host1', 'EU05');
            expect(display.realms.size).toBe(1);
            expect(display.realms.get('host1').label).toBe('EU05');
        });

        it('does nothing for empty hostname', () => {
            display.ensureRealm('', 'EU05');
            expect(display.realms.size).toBe(0);
        });

        it('updates label of existing realm', () => {
            display.ensureRealm('host1', 'EU05');
            display.ensureRealm('host1', 'EU05-Updated');
            expect(display.realms.get('host1').label).toBe('EU05-Updated');
            expect(display.realms.size).toBe(1);
        });

        it('uses hostname as label if none provided', () => {
            display.ensureRealm('my-sandox.demandware.net');
            expect(display.realms.get('my-sandox.demandware.net').label).toBe('my-sandox.demandware.net');
        });
    });

    describe('setTotalSteps', () => {
        it('sets total step count', () => {
            display.ensureRealm('host1', 'EU05');
            display.setTotalSteps('host1', 5);
            expect(display.realms.get('host1').totalSteps).toBe(5);
        });

        it('auto-creates realm if not exists', () => {
            display.setTotalSteps('host2', 3);
            expect(display.realms.has('host2')).toBe(true);
            expect(display.realms.get('host2').totalSteps).toBe(3);
        });
    });

    describe('completeRealm', () => {
        it('marks realm as completed', () => {
            display.ensureRealm('host1', 'EU05');
            display.completeRealm('host1');
            expect(display.realms.get('host1').completed).toBe(true);
        });

        it('marks running steps as done', () => {
            display.ensureRealm('host1', 'EU05');
            display.startStep('host1', 'EU05', 'fetch', 'Fetching');
            display.completeRealm('host1');
            expect(display.realms.get('host1').steps.get('fetch').status).toBe('done');
            expect(display.realms.get('host1').steps.get('fetch').percent).toBe(100);
        });

        it('does nothing for non-existent realm', () => {
            display.completeRealm('nonexistent');
            // Should not throw
        });
    });

    describe('failRealm', () => {
        it('marks realm as failed', () => {
            display.ensureRealm('host1', 'EU05');
            display.failRealm('host1', 'Connection timeout');
            const realm = display.realms.get('host1');
            expect(realm.failed).toBe(true);
            expect(realm.failReason).toBe('Connection timeout');
        });

        it('does nothing for non-existent realm', () => {
            display.failRealm('nonexistent');
            // Should not throw
        });
    });

    // ============================================================================
    // Step management
    // ============================================================================

    describe('startStep', () => {
        it('creates a new step', () => {
            display.startStep('host1', 'EU05', 'fetch', 'Fetching Preferences');
            const step = display.realms.get('host1').steps.get('fetch');
            expect(step.label).toBe('Fetching Preferences');
            expect(step.status).toBe('running');
            expect(step.percent).toBe(0);
        });

        it('resets existing step to running', () => {
            display.startStep('host1', 'EU05', 'fetch', 'Fetching');
            display.completeStep('host1', 'fetch');
            display.startStep('host1', 'EU05', 'fetch', 'Fetching Again');
            const step = display.realms.get('host1').steps.get('fetch');
            expect(step.status).toBe('running');
            expect(step.percent).toBe(0);
        });
    });

    describe('setStepProgress', () => {
        it('sets step percent', () => {
            display.startStep('host1', 'EU05', 'fetch', 'Fetching');
            display.setStepProgress('host1', 'fetch', 50);
            expect(display.realms.get('host1').steps.get('fetch').percent).toBe(50);
        });

        it('clamps percent to 0-100', () => {
            display.startStep('host1', 'EU05', 'fetch', 'Fetching');
            display.setStepProgress('host1', 'fetch', 150);
            expect(display.realms.get('host1').steps.get('fetch').percent).toBe(100);

            display.setStepProgress('host1', 'fetch', -20);
            expect(display.realms.get('host1').steps.get('fetch').percent).toBe(0);
        });

        it('does nothing for non-existent realm', () => {
            display.setStepProgress('nonexistent', 'fetch', 50);
            // Should not throw
        });

        it('does nothing for non-existent step', () => {
            display.ensureRealm('host1', 'EU05');
            display.setStepProgress('host1', 'nonexistent', 50);
            // Should not throw
        });
    });

    describe('completeStep', () => {
        it('marks step as done with 100%', () => {
            display.startStep('host1', 'EU05', 'fetch', 'Fetching');
            display.completeStep('host1', 'fetch');
            const step = display.realms.get('host1').steps.get('fetch');
            expect(step.status).toBe('done');
            expect(step.percent).toBe(100);
        });

        it('does nothing for non-existent step', () => {
            display.ensureRealm('host1', 'EU05');
            display.completeStep('host1', 'nonexistent');
            // Should not throw
        });
    });

    describe('failStep', () => {
        it('marks step as failed', () => {
            display.startStep('host1', 'EU05', 'fetch', 'Fetching');
            display.failStep('host1', 'fetch', 'Timeout');
            const step = display.realms.get('host1').steps.get('fetch');
            expect(step.status).toBe('failed');
            expect(step.message).toBe('Timeout');
        });

        it('marks step as failed without message', () => {
            display.startStep('host1', 'EU05', 'fetch', 'Fetching');
            display.failStep('host1', 'fetch');
            const step = display.realms.get('host1').steps.get('fetch');
            expect(step.status).toBe('failed');
            expect(step.message).toBeNull();
        });
    });

    describe('setStepMessage', () => {
        it('sets a message on a step', () => {
            display.startStep('host1', 'EU05', 'fetch', 'Fetching');
            display.setStepMessage('host1', 'fetch', 'Rate limited', 'warn');
            const step = display.realms.get('host1').steps.get('fetch');
            expect(step.message).toEqual({ text: 'Rate limited', type: 'warn' });
        });

        it('does nothing for non-existent step', () => {
            display.ensureRealm('host1', 'EU05');
            display.setStepMessage('host1', 'nonexistent', 'test');
            // Should not throw
        });
    });

    describe('clearStepMessage', () => {
        it('clears step message', () => {
            display.startStep('host1', 'EU05', 'fetch', 'Fetching');
            display.setStepMessage('host1', 'fetch', 'Warning');
            display.clearStepMessage('host1', 'fetch');
            expect(display.realms.get('host1').steps.get('fetch').message).toBeNull();
        });
    });

    // ============================================================================
    // Rendering — buildLines
    // ============================================================================

    describe('buildLines', () => {
        it('returns empty array with no realms', () => {
            display.frameCount = 1;
            expect(display.buildLines()).toEqual([]);
        });

        it('shows Done for completed realm', () => {
            display.ensureRealm('host1', 'EU05');
            display.completeRealm('host1');
            display.frameCount = 1;
            const lines = display.buildLines();
            expect(lines).toHaveLength(1);
            expect(lines[0]).toContain('EU05');
            expect(lines[0]).toContain('100%');
            expect(lines[0]).toContain('Done');
        });

        it('shows failed for failed realm', () => {
            display.ensureRealm('host1', 'EU05');
            display.failRealm('host1', 'Auth error');
            display.frameCount = 1;
            const lines = display.buildLines();
            expect(lines).toHaveLength(1);
            expect(lines[0]).toContain('EU05');
            expect(lines[0]).toContain('failed');
            expect(lines[0]).toContain('Auth error');
        });

        it('shows dots for realm with no steps', () => {
            display.ensureRealm('host1', 'EU05');
            display.frameCount = 0; // frame 0 => 1 dot
            const lines = display.buildLines();
            expect(lines).toHaveLength(1);
            expect(lines[0]).toContain('EU05');
            expect(lines[0]).toContain('.');
        });

        it('shows progress bar for realm with running step', () => {
            display.ensureRealm('host1', 'EU05');
            display.setTotalSteps('host1', 2);
            display.startStep('host1', 'EU05', 'fetch', 'Fetching');
            display.setStepProgress('host1', 'fetch', 50);
            display.frameCount = 1;
            const lines = display.buildLines();
            expect(lines).toHaveLength(1);
            expect(lines[0]).toContain('EU05');
            expect(lines[0]).toContain('Fetching');
            expect(lines[0]).toContain('%');
        });

        it('calculates overall progress with completed steps', () => {
            display.ensureRealm('host1', 'EU05');
            display.setTotalSteps('host1', 2);
            display.startStep('host1', 'EU05', 'step1', 'Step One');
            display.completeStep('host1', 'step1');
            display.startStep('host1', 'EU05', 'step2', 'Step Two');
            display.setStepProgress('host1', 'step2', 50);
            display.frameCount = 1;
            const lines = display.buildLines();
            // 1 done out of 2 = 50%, + running step 50/2 = 25% => 75% total
            expect(lines[0]).toContain('75%');
        });

        it('renders multiple realms', () => {
            display.ensureRealm('host1', 'EU05');
            display.ensureRealm('host2', 'APAC');
            display.frameCount = 1;
            const lines = display.buildLines();
            expect(lines).toHaveLength(2);
            expect(lines[0]).toContain('EU05');
            expect(lines[1]).toContain('APAC');
        });
    });

    // ============================================================================
    // Rendering — render
    // ============================================================================

    describe('render', () => {
        it('does not render when not running and not forced', () => {
            display.ensureRealm('host1', 'EU05');
            display.render();
            expect(writeSpy).not.toHaveBeenCalled();
        });

        it('renders when forced even if not running', () => {
            display.ensureRealm('host1', 'EU05');
            display.render(true);
            expect(writeSpy).toHaveBeenCalled();
        });

        it('writes to stdout when running', () => {
            display.ensureRealm('host1', 'EU05');
            display.start();
            // Advance timer to trigger render
            vi.advanceTimersByTime(100);
            expect(writeSpy).toHaveBeenCalled();
        });

        it('updates renderedLineCount', () => {
            display.ensureRealm('host1', 'EU05');
            display.ensureRealm('host2', 'APAC');
            display.start();
            vi.advanceTimersByTime(100);
            expect(display.renderedLineCount).toBe(2);
        });

        it('does not render empty display if no previous lines', () => {
            display.start();
            display.render(true);
            // With no realms and no previous lines, render returns early
        });
    });

    // ============================================================================
    // Console suppression
    // ============================================================================

    describe('console suppression', () => {
        it('buffers console.log during running', () => {
            const originalLog = console.log;
            display.start();
            // console.log is now suppressed/buffered
            expect(console.log).not.toBe(originalLog);
            display.stop();
            // console.log restored
            expect(console.log).toBe(originalLog);
        });

        it('flushes buffered logs on stop', () => {
            const logSpy = vi.fn();
            const savedLog = console.log;

            display.start();
            // Manually push to buffer to simulate buffered logs
            display._logBuffer.push(['test message']);
            display.stop();

            // After stop, console.log is restored and buffer is flushed
            expect(display._logBuffer).toHaveLength(0);
        });

        it('suppresses console.warn during running', () => {
            display.start();
            // console.warn should be no-op now
            console.warn('this is suppressed');
            display.stop();
            // Should not throw
        });
    });
});
