/**
 * Timer Utilities
 * Track command execution time and overhead
 */

/**
 * Start a timer for tracking command execution time
 * See .github/instructions/function-reference.md for detailed documentation
 * @returns {Object} Timer object with startTime and methods
 */
export function startTimer() {
    return {
        startTime: Date.now(),
        endTime: null,
        checkpoints: [],
        addCheckpoint(label) {
            const elapsed = Date.now() - this.startTime;
            this.checkpoints.push({ label, elapsed });
            return elapsed;
        },
        getElapsed() {
            return (this.endTime || Date.now()) - this.startTime;
        },
        formatElapsed() {
            const totalSeconds = Math.round(this.getElapsed() / 1000);
            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;
            return minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
        },
        stop() {
            this.endTime = Date.now();
            return this.formatElapsed();
        }
    };
}
