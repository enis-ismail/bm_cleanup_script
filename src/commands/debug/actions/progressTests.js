import { startTimer } from '../../../helpers/timer.js';
import { RealmProgressDisplay } from '../../../scripts/loggingScript/progressDisplay.js';

// ============================================================================
// TEST CONCURRENT TIMERS
// Test dynamic parent/child progress logging
// ============================================================================

/**
 * Test dynamic parent/child progress logging.
 */
export async function testConcurrentTimers() {
    const UPDATE_INTERVAL_MS = 250;
    const overallTimer = startTimer();

    console.log(`\n${'='.repeat(80)}`);
    console.log('🚀 Starting dynamic parent/child progress test');
    console.log(`${'='.repeat(80)}\n`);
    const progressDisplay = new RealmProgressDisplay(UPDATE_INTERVAL_MS);

    const realms = [
        {
            name: 'bcwr-080',
            hostname: 'bcwr-080.dx.commercecloud.salesforce.com'
        },
        {
            name: 'eu05',
            hostname: 'eu05.dx.commercecloud.salesforce.com'
        }
    ];

    const childDefinitions = realms.flatMap((realm, realmIndex) => ([
        {
            realmIndex,
            label: 'Fetching Data',
            durationMs: 2000 + Math.floor(Math.random() * 3000),
            startDelayMs: Math.floor(Math.random() * 1200)
        },
        {
            realmIndex,
            label: 'Building Matrices',
            durationMs: 3000 + Math.floor(Math.random() * 4000),
            startDelayMs: 1200 + Math.floor(Math.random() * 2000)
        },
        {
            realmIndex,
            label: 'Exporting Results',
            durationMs: 1500 + Math.floor(Math.random() * 2500),
            startDelayMs: 3200 + Math.floor(Math.random() * 2000)
        }
    ]));

    try {
        progressDisplay.start();

        const tasks = childDefinitions.map((definition, index) => {
            const realm = realms[definition.realmIndex];
            const stepKey = `${definition.label}-${index}`;
            return runChildProcess(
                realm,
                definition.label,
                definition.durationMs,
                definition.startDelayMs,
                stepKey,
                progressDisplay
            );
        });

        const results = await Promise.all(tasks);
        progressDisplay.stop();

        console.log(`\n${'='.repeat(80)}`);
        console.log('📊 Parent/Child Progress Results');
        console.log(`${'='.repeat(80)}\n`);

        results.forEach((result) => {
            const seconds = (result.durationMs / 1000).toFixed(2);
            console.log(`  ${result.realm} - ${result.label}: ${seconds}s`);
        });

        const totalElapsed = overallTimer.stop();
        console.log(`\n  Total elapsed: ${totalElapsed}`);
        console.log('  ✓ Dynamic progress test completed successfully!\n');
    } catch (error) {
        progressDisplay.stop();
        console.error(`\n❌ Error: ${error.message}`);
    }
}

// ============================================================================
// DEBUG PROGRESS
// Simulate analyze-preferences progress display with console interference
// ============================================================================

/**
 * Simulate analyze-preferences progress display with console interference.
 */
export async function debugProgress() {
    const overallTimer = startTimer();

    console.log(`\n${'='.repeat(80)}`);
    console.log('🚀 Starting progress display simulation');
    console.log('   Simulates 4 realms in parallel, sequential steps per realm');
    console.log('   Injects console.error / console.warn calls to test suppression');
    console.log(`${'='.repeat(80)}\n`);

    const display = new RealmProgressDisplay(250);

    const realms = [
        { name: 'APAC', hostname: 'apac.dx.commercecloud.salesforce.com' },
        { name: 'EU05', hostname: 'eu05.dx.commercecloud.salesforce.com' },
        { name: 'GB', hostname: 'gb.dx.commercecloud.salesforce.com' },
        { name: 'PNA', hostname: 'pna.dx.commercecloud.salesforce.com' }
    ];

    const stepDefs = [
        { key: 'backup', label: 'Downloading Backup', durationMs: [1500, 3000] },
        { key: 'fetch', label: 'Reading Metadata XML', durationMs: [1000, 2000] },
        { key: 'groups', label: 'Reading Attribute Groups', durationMs: [1000, 2000] },
        { key: 'matrices', label: 'Building Matrices', durationMs: [2000, 3500] },
        { key: 'export', label: 'Exporting Results', durationMs: [500, 1500] }
    ];

    try {
        display.start();

        // Run all realms in parallel
        await Promise.all(realms.map((realm, i) =>
            processSimulatedRealm(realm, i, stepDefs, display)
        ));

        display.finish();

        console.log(`\n${'='.repeat(80)}`);
        console.log('📊 Progress Display Test Results');
        console.log(`${'='.repeat(80)}\n`);
        console.log('  If you see any [LEAK] messages above the separator,');
        console.log('  console suppression failed.\n');

        const totalElapsed = overallTimer.stop();
        console.log(`  Total elapsed: ${totalElapsed}`);
        console.log('  ✓ Progress display test completed successfully!\n');
    } catch (error) {
        display.stop();
        console.error(`\n❌ Error: ${error.message}`);
    }
}

// ============================================================================
// PRIVATE HELPER FUNCTIONS
// ============================================================================

/**
 * Run a simulated child process for the concurrent timers test.
 * @param {Object} realm - Realm object with name and hostname
 * @param {string} label - Step label
 * @param {number} durationMs - Duration in milliseconds
 * @param {number} startDelayMs - Start delay in milliseconds
 * @param {string} stepKey - Unique step key
 * @param {RealmProgressDisplay} progressDisplay - Progress display instance
 * @returns {Promise<Object>} Result with realm, label, and duration
 * @private
 */
function runChildProcess(realm, label, durationMs, startDelayMs, stepKey, progressDisplay) {
    return new Promise((resolve) => {
        setTimeout(() => {
            progressDisplay.startStep(realm.hostname, realm.name, stepKey, label);
            const startTime = Date.now();
            const interval = setInterval(() => {
                const elapsed = Date.now() - startTime;
                const percent = Math.min(100, Math.round((elapsed / durationMs) * 100));
                progressDisplay.setStepProgress(realm.hostname, stepKey, percent);
            }, 100);

            setTimeout(() => {
                clearInterval(interval);
                progressDisplay.completeStep(realm.hostname, stepKey);
                resolve({ realm: realm.name, label, durationMs });
            }, durationMs);
        }, startDelayMs);
    });
}

/**
 * Process a simulated realm for the debug-progress command.
 * Runs all steps sequentially and injects console interference.
 * @param {Object} realm - Realm object with name and hostname
 * @param {number} realmIndex - Index for staggering start times
 * @param {Array} stepDefs - Step definitions
 * @param {RealmProgressDisplay} display - Progress display instance
 * @returns {Promise<void>}
 * @private
 */
async function processSimulatedRealm(realm, realmIndex, stepDefs, display) {
    const randomBetween = (min, max) => min + Math.floor(Math.random() * (max - min));
    const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms));

    // Stagger start times so realms don't begin simultaneously
    await sleep(realmIndex * randomBetween(200, 600));

    display.setTotalSteps(realm.hostname, stepDefs.length);

    for (let i = 0; i < stepDefs.length; i++) {
        const stepDef = stepDefs[i];
        const duration = randomBetween(stepDef.durationMs[0], stepDef.durationMs[1]);
        display.startStep(realm.hostname, realm.name, stepDef.key, stepDef.label);

        const startTime = Date.now();
        while (Date.now() - startTime < duration) {
            const elapsed = Date.now() - startTime;
            const percent = Math.min(100, Math.round((elapsed / duration) * 100));
            display.setStepProgress(realm.hostname, stepDef.key, percent);
            await sleep(100);
        }

        display.completeStep(realm.hostname, stepDef.key);

        // Inject console interference after certain steps
        if (i === 0) {
            console.log(`[LEAK] ${realm.name}: this console.log should be suppressed`);
        }
        if (i === 1) {
            console.error(`[LEAK] ${realm.name}: this console.error should be suppressed`);
        }
        if (i === 2) {
            console.warn(`[LEAK] ${realm.name}: this console.warn should be suppressed`);
        }
    }

    display.completeRealm(realm.hostname);
}
