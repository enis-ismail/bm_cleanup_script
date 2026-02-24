/**
 * Hierarchical CLI progress display for analyze-preferences workflow.
 * Tracks realms by hostname and lazily adds step bars when each step starts.
 */

const DEFAULT_UPDATE_INTERVAL_MS = 250;
const DEFAULT_BAR_WIDTH = 18;

function clampPercent(value) {
    if (!Number.isFinite(value)) {
        return 0;
    }

    return Math.max(0, Math.min(100, Math.round(value)));
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

export class RealmProgressDisplay {
    constructor(updateIntervalMs = DEFAULT_UPDATE_INTERVAL_MS) {
        this.updateIntervalMs = updateIntervalMs;
        this.realms = new Map();
        this.interval = null;
        this.isRunning = false;
        this.renderedLineCount = 0;
    }

    start() {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        this.interval = setInterval(() => {
            this.render();
        }, this.updateIntervalMs);
    }

    stop() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        this.render(true);
        this.isRunning = false;
    }

    /**
     * Finalize and close the progress display.
     * Marks all running steps as done, renders a final clean frame, then clears state.
     */
    finish() {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }

        // Mark every still-running step as done at 100%
        for (const realm of this.realms.values()) {
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

        // Clear realm data so re-starting won't re-render old progress
        this.realms.clear();
        this.renderedLineCount = 0;
    }

    ensureRealm(hostname, realmLabel) {
        if (!hostname) {
            return;
        }

        if (!this.realms.has(hostname)) {
            this.realms.set(hostname, {
                hostname,
                label: realmLabel || hostname,
                frame: 0,
                steps: new Map()
            });
            return;
        }

        const existing = this.realms.get(hostname);
        if (realmLabel && existing.label !== realmLabel) {
            existing.label = realmLabel;
        }
    }

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

    render(force = false) {
        if (!this.isRunning && !force) {
            return;
        }

        const lines = this.buildLines();

        if (this.renderedLineCount > 0) {
            process.stdout.write(`\x1b[${this.renderedLineCount}A`);
            process.stdout.write('\x1b[0J');
        }

        if (lines.length === 0) {
            this.renderedLineCount = 0;
            return;
        }

        // Truncate lines to terminal width to prevent line-wrap from
        // breaking cursor-up math (wrapped lines count as >1 physical lines
        // but renderedLineCount only tracks logical lines).
        const maxWidth = (process.stdout.columns || 80) - 1;

        lines.forEach((line, index) => {
            process.stdout.write(line.length > maxWidth ? line.slice(0, maxWidth) : line);
            if (index < lines.length - 1) {
                process.stdout.write('\n');
            }
        });
        process.stdout.write('\n');

        this.renderedLineCount = lines.length;
    }

    buildLines() {
        const lines = [];

        for (const realm of this.realms.values()) {
            realm.frame += 1;
            const dots = getAnimatedDots(realm.frame);
            const realmStatus = this.getRealmStatus(realm);
            const realmIndicator = realmStatus === 'done' ? '✓' : dots;
            lines.push(`Realm ${realm.label}: ${realmIndicator}`);

            const steps = Array.from(realm.steps.values());
            steps.forEach((step, index) => {
                const isLast = index === steps.length - 1;
                const prefix = isLast ? '  └─ ' : '  ├─ ';
                const icon = step.status === 'done'
                    ? '✅'
                    : step.status === 'failed'
                        ? '❌'
                        : '⏳';
                const bar = buildProgressBar(step.percent);
                let line = `${prefix}${icon} ${step.label}: ${bar} ${step.percent}%`;
                
                // Append warning/error message if present
                if (step.message) {
                    const msgType = typeof step.message === 'string' ? 'WARN' : step.message.type?.toUpperCase() || 'WARN';
                    const msgText = typeof step.message === 'string' ? step.message : step.message.text;
                    line += ` [${msgType}: ${msgText}]`;
                }
                
                lines.push(line);
            });
        }

        return lines;
    }

    getRealmStatus(realm) {
        const steps = Array.from(realm.steps.values());
        if (steps.length === 0) {
            return 'running';
        }

        const hasRunning = steps.some(step => step.status === 'running');
        if (hasRunning) {
            return 'running';
        }

        const hasFailed = steps.some(step => step.status === 'failed');
        if (hasFailed) {
            return 'failed';
        }

        return 'done';
    }
}