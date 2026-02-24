/**
 * Hierarchical CLI progress display for parallel realm processing.
 *
 * Architecture:
 *   The COMMAND creates the display and controls its lifecycle.
 *   Helper functions receive the display instance and call startStep / updateProgress / etc.
 *   Console output (log, error, warn) is suppressed while the display is running
 *   to prevent external writes from shifting the terminal cursor.
 *
 * Data model per realm:
 *   { id, label, status, steps: Map<key, { label, percent, status, message }> }
 *
 * Render approach:
 *   1. Build all output lines from realm data
 *   2. Assemble a single string: cursor-up + per-line content + trailing clear
 *   3. Write atomically via one process.stdout.write() call
 *   4. renderedLineCount always equals lines.length (no accumulation)
 *
 * Usage:
 *   const display = new RealmProgressDisplay();
 *   display.start();
 *
 *   display.startStep(hostname, 'APAC', 'fetch', 'Fetching Preferences');
 *   display.setStepProgress(hostname, 'fetch', 50);
 *   display.completeStep(hostname, 'fetch');
 *   display.completeRealm(hostname);
 *
 *   display.finish();  // final frame, restores console
 */

const DEFAULT_UPDATE_INTERVAL_MS = 250;
const DEFAULT_BAR_WIDTH = 18;

// ============================================================================
// Utility functions
// ============================================================================

function clampPercent(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.max(0, Math.min(100, Math.round(value)));
}

/**
 * Check if a Unicode code point occupies two terminal columns (CJK, emoji, etc.)
 */
function isWideCodePoint(codePoint) {
    return (
        (codePoint >= 0x1100 && codePoint <= 0x115F)
        || (codePoint >= 0x2329 && codePoint <= 0x232A)
        || (codePoint >= 0x2E80 && codePoint <= 0xA4CF && codePoint !== 0x303F)
        || (codePoint >= 0xAC00 && codePoint <= 0xD7A3)
        || (codePoint >= 0xF900 && codePoint <= 0xFAFF)
        || (codePoint >= 0xFE10 && codePoint <= 0xFE19)
        || (codePoint >= 0xFE30 && codePoint <= 0xFE6F)
        || (codePoint >= 0xFF00 && codePoint <= 0xFF60)
        || (codePoint >= 0xFFE0 && codePoint <= 0xFFE6)
        || (codePoint >= 0x1F000 && codePoint <= 0x1FAFF)
    );
}

function getDisplayWidth(text) {
    let width = 0;
    for (const char of text) {
        const codePoint = char.codePointAt(0);
        width += isWideCodePoint(codePoint) ? 2 : 1;
    }
    return width;
}

function truncateToWidth(text, maxWidth) {
    let width = 0;
    let output = '';
    for (const char of text) {
        const codePoint = char.codePointAt(0);
        const charWidth = isWideCodePoint(codePoint) ? 2 : 1;
        if (width + charWidth > maxWidth) {
            break;
        }
        output += char;
        width += charWidth;
    }
    return output;
}

function buildProgressBar(percent, width = DEFAULT_BAR_WIDTH) {
    const safePercent = clampPercent(percent);
    const filled = Math.round((safePercent / 100) * width);
    const empty = Math.max(0, width - filled);
    return `[${'█'.repeat(filled)}${'░'.repeat(empty)}]`;
}

export function getAnimatedDots(frameIndex) {
    const dotCount = (Math.max(0, frameIndex) % 3) + 1;
    return '.'.repeat(dotCount);
}

// ============================================================================
// RealmProgressDisplay
// ============================================================================

export class RealmProgressDisplay {
    constructor(updateIntervalMs = DEFAULT_UPDATE_INTERVAL_MS) {
        this.updateIntervalMs = updateIntervalMs;
        this.realms = new Map();
        this.interval = null;
        this.isRunning = false;
        this.renderedLineCount = 0;
        this.frameCount = 0;
        this._savedConsole = null;
    }

    // ------------------------------------------------------------------
    // Console suppression — prevents external writes from shifting cursor
    // ------------------------------------------------------------------

    _suppressConsole() {
        if (this._savedConsole) {
            return;
        }

        this._savedConsole = {
            log: console.log,
            error: console.error,
            warn: console.warn
        };
        console.log = () => {};
        console.error = () => {};
        console.warn = () => {};
    }

    _restoreConsole() {
        if (!this._savedConsole) {
            return;
        }

        console.log = this._savedConsole.log;
        console.error = this._savedConsole.error;
        console.warn = this._savedConsole.warn;
        this._savedConsole = null;
    }

    // ------------------------------------------------------------------
    // Lifecycle
    // ------------------------------------------------------------------

    start() {
        if (this.isRunning) {
            return;
        }

        this._suppressConsole();
        this.isRunning = true;
        this.interval = setInterval(() => this.render(), this.updateIntervalMs);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        this.render(true);
        this.isRunning = false;
        this._restoreConsole();
    }

    /**
     * Finalize and close the progress display.
     * Marks all realms as completed, renders a final clean frame, restores console,
     * then clears internal state.
     */
    finish() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        // Mark every realm as completed and every still-running step as done
        for (const realm of this.realms.values()) {
            realm.completed = true;
            for (const step of realm.steps.values()) {
                if (step.status === 'running') {
                    step.status = 'done';
                    step.percent = 100;
                }
                step.message = null;
            }
        }

        // Render one final frame showing completed state
        this.render(true);
        this.isRunning = false;
        this._restoreConsole();

        // Clear realm data so re-starting won't re-render old progress
        this.realms.clear();
        this.renderedLineCount = 0;
        this.frameCount = 0;
    }

    // ------------------------------------------------------------------
    // Realm management
    // ------------------------------------------------------------------

    ensureRealm(hostname, realmLabel) {
        if (!hostname) {
            return;
        }

        if (!this.realms.has(hostname)) {
            this.realms.set(hostname, {
                hostname,
                label: realmLabel || hostname,
                completed: false,
                failed: false,
                failReason: null,
                totalSteps: 0,
                steps: new Map()
            });
            return;
        }

        const existing = this.realms.get(hostname);
        if (realmLabel && existing.label !== realmLabel) {
            existing.label = realmLabel;
        }
    }

    /**
     * Set the total number of steps for a realm.
     * This is used to calculate overall progress (each step = 100/totalSteps %).
     * Must be called before the first startStep() so the bar doesn't jump.
     * Auto-creates the realm entry if it doesn't exist yet.
     */
    setTotalSteps(hostname, count) {
        this.ensureRealm(hostname);
        const realm = this.realms.get(hostname);
        if (!realm) {
            return;
        }

        realm.totalSteps = count;
    }

    /**
     * Mark a realm as fully completed. Only realms marked via this method
     * will collapse to a single summary line in the display.
     */
    completeRealm(hostname) {
        const realm = this.realms.get(hostname);
        if (!realm) {
            return;
        }

        realm.completed = true;

        for (const step of realm.steps.values()) {
            if (step.status === 'running') {
                step.status = 'done';
                step.percent = 100;
            }
        }
    }

    /**
     * Mark a realm as failed. Failed realms collapse to a single error line.
     * @param {string} hostname - Realm hostname
     * @param {string} [reason] - Short failure reason to display
     */
    failRealm(hostname, reason = null) {
        const realm = this.realms.get(hostname);
        if (!realm) {
            return;
        }

        realm.failed = true;
        realm.failReason = reason;
    }

    // ------------------------------------------------------------------
    // Step / process management
    // ------------------------------------------------------------------

    startStep(hostname, realmLabel, stepKey, stepLabel) {
        this.ensureRealm(hostname, realmLabel);

        const realm = this.realms.get(hostname);
        if (!realm) {
            return;
        }

        const existing = realm.steps.get(stepKey);
        if (existing) {
            existing.status = 'running';
            existing.percent = 0;
            return;
        }

        realm.steps.set(stepKey, {
            key: stepKey,
            label: stepLabel,
            status: 'running',
            percent: 0,
            message: null
        });
    }

    setStepProgress(hostname, stepKey, percent) {
        const realm = this.realms.get(hostname);
        if (!realm) {
            return;
        }

        const step = realm.steps.get(stepKey);
        if (!step) {
            return;
        }

        step.percent = clampPercent(percent);
    }

    completeStep(hostname, stepKey) {
        const realm = this.realms.get(hostname);
        if (!realm) {
            return;
        }

        const step = realm.steps.get(stepKey);
        if (!step) {
            return;
        }

        step.status = 'done';
        step.percent = 100;
    }

    failStep(hostname, stepKey, message = null) {
        const realm = this.realms.get(hostname);
        if (!realm) {
            return;
        }

        const step = realm.steps.get(stepKey);
        if (!step) {
            return;
        }

        step.status = 'failed';
        if (message) {
            step.message = message;
        }
    }

    setStepMessage(hostname, stepKey, message, type = 'warn') {
        const realm = this.realms.get(hostname);
        if (!realm) {
            return;
        }

        const step = realm.steps.get(stepKey);
        if (!step) {
            return;
        }

        step.message = { text: message, type };
    }

    clearStepMessage(hostname, stepKey) {
        const realm = this.realms.get(hostname);
        if (!realm) {
            return;
        }

        const step = realm.steps.get(stepKey);
        if (!step) {
            return;
        }

        step.message = null;
    }

    // ------------------------------------------------------------------
    // Rendering
    // ------------------------------------------------------------------

    render(force = false) {
        if (!this.isRunning && !force) {
            return;
        }

        this.frameCount++;
        const lines = this.buildLines();

        // Build the entire frame as a single string and write it atomically.
        let frame = '';

        // Move cursor up to the start of the previous frame
        if (this.renderedLineCount > 0) {
            frame += `\x1b[${this.renderedLineCount}A`;
        }

        if (lines.length === 0 && this.renderedLineCount === 0) {
            return;
        }

        // Truncate lines to terminal width to prevent line-wrap from
        // breaking cursor-up math (wrapped lines count as >1 physical lines
        // but renderedLineCount only tracks logical lines).
        const maxWidth = (process.stdout.columns || 80) - 1;

        for (const line of lines) {
            const lineWidth = getDisplayWidth(line);
            const safeLine = lineWidth > maxWidth
                ? truncateToWidth(line, maxWidth)
                : line;
            frame += `\x1b[2K${safeLine}\n`;
        }

        // Clear everything below the last content line.
        // This erases ghost lines left when the frame shrinks (e.g. realm completes).
        frame += '\x1b[0J';

        process.stdout.write(frame);
        this.renderedLineCount = lines.length;
    }

    buildLines() {
        const lines = [];
        const dots = getAnimatedDots(this.frameCount);

        for (const realm of this.realms.values()) {
            if (realm.completed) {
                lines.push(`Realm ${realm.label}: ${buildProgressBar(100)} 100% — Done`);
                continue;
            }
            if (realm.failed) {
                const reason = realm.failReason ? ` — ${realm.failReason}` : '';
                lines.push(`Realm ${realm.label}: \u2717 failed${reason}`);
                continue;
            }

            const steps = Array.from(realm.steps.values());

            if (steps.length === 0) {
                lines.push(`Realm ${realm.label}: ${dots}`);
                continue;
            }

            // Overall progress: completed steps + running step's proportional slice
            // Each step is worth (100 / totalSteps) percent of the overall bar.
            const total = realm.totalSteps || steps.length;
            const doneCount = steps.filter(s => s.status === 'done').length;
            const runningStep = steps.findLast(s => s.status === 'running');
            const runningSlice = runningStep
                ? (runningStep.percent / total)
                : 0;
            const overallPercent = clampPercent(
                ((doneCount / total) * 100) + runningSlice
            );

            const currentStep = runningStep || steps[steps.length - 1];
            const bar = buildProgressBar(overallPercent);
            lines.push(
                `Realm ${realm.label}: ${bar} ${overallPercent}%`
                + ` — ${currentStep.label}`
            );
        }

        return lines;
    }
}
