import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Imports — log.js functions
// ============================================================================

import {
    log,
    logSectionTitle,
    logCheckPreferencesStart,
    logNoMatrixFiles,
    logMatrixFilesFound,
    logProcessingRealm,
    logEmptyCSV,
    logUnusedPreferencesFound,
    logUnusedPreferencesSaved,
    logNoUnusedPreferences,
    logGettingPreferences,
    logPreferencesSaved,
    logComplete,
    logError,
    logRealmResults,
    logSummaryHeader,
    logRealmSummary,
    logSummaryFooter,
    logCartridgeValidationSummaryHeader,
    logRealmsProcessed,
    logCartridgeValidationStats,
    logCartridgeValidationWarning,
    logCartridgeValidationSummaryFooter,
    logSiteXmlValidationSummary,
    logCartridgeList,
    logStatusUpdate,
    logRateLimitWarning,
    logRateLimitCountdown,
    logCompletion,
    logStatusClear,
    logProgress,
    logRuntime,
    logDeletionSummary,
    logRestoreSummary,
    logBackupClassification
} from '../../src/scripts/loggingScript/log.js';

// ============================================================================
// Test setup
// ============================================================================

let logSpy;
let errorSpy;
let warnSpy;

beforeEach(() => {
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

// ============================================================================
// Tests — Basic logging functions
// ============================================================================

describe('log', () => {
    it('logs a message without newline by default', () => {
        log('hello');
        expect(logSpy).toHaveBeenCalledWith('hello');
    });

    it('logs a message with trailing newline when requested', () => {
        log('hello', true);
        expect(logSpy).toHaveBeenCalledWith('hello\n');
    });
});

describe('logSectionTitle', () => {
    it('logs title between separator lines', () => {
        logSectionTitle('My Title');
        expect(logSpy).toHaveBeenCalledTimes(3);
        // Second call should be the title
        expect(logSpy.mock.calls[1][0]).toBe('My Title');
    });
});

describe('logCheckPreferencesStart', () => {
    it('logs the check preferences message', () => {
        logCheckPreferencesStart();
        expect(logSpy).toHaveBeenCalled();
    });
});

describe('logNoMatrixFiles', () => {
    it('logs no matrix files message', () => {
        logNoMatrixFiles();
        expect(logSpy).toHaveBeenCalledWith('No matrix files found in the results folder.');
    });
});

describe('logMatrixFilesFound', () => {
    it('logs the count of matrix files', () => {
        logMatrixFilesFound(5);
        expect(logSpy).toHaveBeenCalledWith('Found 5 matrix file(s).\n');
    });
});

describe('logProcessingRealm', () => {
    it('logs the realm being processed', () => {
        logProcessingRealm('EU05');
        expect(logSpy).toHaveBeenCalledWith('\n=== Processing Realm: EU05 ===');
    });
});

describe('logEmptyCSV', () => {
    it('logs empty CSV message', () => {
        logEmptyCSV();
        expect(logSpy).toHaveBeenCalledWith('  (empty or could not parse)');
    });
});

describe('logUnusedPreferencesFound', () => {
    it('logs the count of unused preferences', () => {
        logUnusedPreferencesFound(12);
        expect(logSpy).toHaveBeenCalledWith('  Found 12 unused preference(s)\n');
    });
});

describe('logUnusedPreferencesSaved', () => {
    it('logs the save path', () => {
        logUnusedPreferencesSaved('/tmp/unused.txt');
        expect(logSpy).toHaveBeenCalledWith('  Saved to: /tmp/unused.txt');
    });
});

describe('logNoUnusedPreferences', () => {
    it('logs no unused preferences message', () => {
        logNoUnusedPreferences();
        expect(logSpy).toHaveBeenCalledWith('  No unused preferences found.');
    });
});

describe('logGettingPreferences', () => {
    it('logs object type, instance type, and realm', () => {
        logGettingPreferences('SitePreferences', 'development', 'EU05');
        const output = logSpy.mock.calls[0][0];
        expect(output).toContain('SitePreferences');
        expect(output).toContain('development');
        expect(output).toContain('EU05');
    });
});

describe('logPreferencesSaved', () => {
    it('logs the saved file path', () => {
        logPreferencesSaved('/tmp/prefs.json');
        expect(logSpy).toHaveBeenCalledWith('\nPreferences saved to: /tmp/prefs.json');
    });
});

describe('logComplete', () => {
    it('logs completion message', () => {
        logComplete();
        expect(logSpy).toHaveBeenCalledWith('\nComplete!');
    });
});

describe('logError', () => {
    it('logs error to console.error with formatting', () => {
        logError('something broke');
        expect(errorSpy).toHaveBeenCalled();
        const output = errorSpy.mock.calls[0][0];
        expect(output).toContain('something broke');
    });
});

describe('logRealmResults', () => {
    it('logs unused count and filename', () => {
        logRealmResults(100, 25, '/results/EU05_unused.txt');
        const output = logSpy.mock.calls[0][0];
        expect(output).toContain('25');
        expect(output).toContain('100');
        expect(output).toContain('EU05_unused.txt');
    });
});

// ============================================================================
// Tests — Summary logging
// ============================================================================

describe('logSummaryHeader', () => {
    it('logs summary header with separator', () => {
        logSummaryHeader();
        expect(logSpy).toHaveBeenCalledTimes(3);
        expect(logSpy.mock.calls[1][0]).toBe('SUMMARY');
    });
});

describe('logRealmSummary', () => {
    it('logs realm statistics', () => {
        logRealmSummary({ realm: 'EU05', total: 100, used: 80, unused: 20 });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('EU05');
        expect(allOutput).toContain('100');
        expect(allOutput).toContain('80');
        expect(allOutput).toContain('20');
        expect(allOutput).toContain('80.00%');
    });

    it('handles zero total', () => {
        logRealmSummary({ realm: 'EMPTY', total: 0, used: 0, unused: 0 });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('EMPTY');
    });
});

describe('logSummaryFooter', () => {
    it('logs a separator line', () => {
        logSummaryFooter();
        expect(logSpy).toHaveBeenCalled();
    });
});

// ============================================================================
// Tests — Cartridge validation logging
// ============================================================================

describe('logCartridgeValidationSummaryHeader', () => {
    it('logs validation summary header', () => {
        logCartridgeValidationSummaryHeader();
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('CARTRIDGE VALIDATION SUMMARY');
    });
});

describe('logRealmsProcessed', () => {
    it('logs each realm with its site count', () => {
        logRealmsProcessed([
            { realm: 'EU05', siteCount: 3 },
            { realm: 'APAC', siteCount: 5 }
        ]);
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('EU05');
        expect(allOutput).toContain('APAC');
    });
});

describe('logCartridgeValidationStats', () => {
    it('logs cartridge validation statistics', () => {
        logCartridgeValidationStats({
            realmSummary: [{ siteCount: 3 }, { siteCount: 5 }],
            comparisonResult: {
                total: 20,
                used: new Array(15),
                unused: new Array(5)
            }
        });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('8');  // total sites
        expect(allOutput).toContain('20'); // total cartridges
        expect(allOutput).toContain('15'); // used
        expect(allOutput).toContain('5');  // unused
    });
});

describe('logCartridgeValidationWarning', () => {
    it('logs warning with count and file path', () => {
        logCartridgeValidationWarning(3, '/results/unused.txt');
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('3');
        expect(allOutput).toContain('/results/unused.txt');
    });
});

describe('logCartridgeValidationSummaryFooter', () => {
    it('logs footer separator', () => {
        logCartridgeValidationSummaryFooter();
        expect(logSpy).toHaveBeenCalled();
    });
});

describe('logSiteXmlValidationSummary', () => {
    it('logs site XML validation stats', () => {
        logSiteXmlValidationSummary({ total: 10, matching: 8, mismatched: 2 });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('10');
        expect(allOutput).toContain('8');
        expect(allOutput).toContain('2');
    });
});

describe('logCartridgeList', () => {
    it('logs each cartridge with arrow', () => {
        logCartridgeList(['app_storefront_base', 'int_adyen']);
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('app_storefront_base');
        expect(allOutput).toContain('int_adyen');
        expect(allOutput).toContain('2');
    });
});

// ============================================================================
// Tests — Dynamic status logging
// ============================================================================

describe('logStatusUpdate', () => {
    it('logs a status message', () => {
        logStatusUpdate('Loading data...');
        expect(logSpy).toHaveBeenCalled();
        const output = logSpy.mock.calls[0][0];
        expect(output).toContain('Loading data...');
    });

    it('does not log duplicate consecutive messages', () => {
        // Reset internal state by calling with a unique message first
        logStatusUpdate('unique-msg-dedup-test-1');
        logSpy.mockClear();

        logStatusUpdate('same message');
        logStatusUpdate('same message');
        expect(logSpy).toHaveBeenCalledTimes(1);
    });

    it('does not log empty message', () => {
        logStatusUpdate('');
        expect(logSpy).not.toHaveBeenCalled();
    });
});

describe('logRateLimitWarning', () => {
    it('logs warning to console.warn', () => {
        logRateLimitWarning('Too many requests');
        expect(warnSpy).toHaveBeenCalled();
        const output = warnSpy.mock.calls[0][0];
        expect(output).toContain('Too many requests');
    });
});

describe('logRateLimitCountdown', () => {
    it('logs countdown with delay and attempt number', () => {
        logRateLimitCountdown(5000, 2, 'c_myPref');
        expect(warnSpy).toHaveBeenCalled();
        const output = warnSpy.mock.calls[0][0];
        expect(output).toContain('5s');
        expect(output).toContain('2/3');
        expect(output).toContain('c_myPref');
    });

    it('works without context', () => {
        logRateLimitCountdown(3000, 1);
        const output = warnSpy.mock.calls[0][0];
        expect(output).toContain('3s');
        expect(output).not.toContain(' on ');
    });
});

describe('logCompletion', () => {
    it('logs a green completion message', () => {
        logCompletion('All done');
        expect(logSpy).toHaveBeenCalled();
        const output = logSpy.mock.calls[0][0];
        expect(output).toContain('All done');
    });
});

describe('logStatusClear', () => {
    it('resets internal state without logging', () => {
        logStatusClear();
        // Should not throw and should not log
        expect(logSpy).not.toHaveBeenCalled();
    });
});

describe('logProgress', () => {
    it('logs progress at matching intervals when isFirstSearch is true', () => {
        logProgress({
            scannedFiles: 50,
            totalFiles: 200,
            logEvery: 50,
            matchesFound: 3
        }, true);
        expect(logSpy).toHaveBeenCalled();
        const output = logSpy.mock.calls[0][0];
        expect(output).toContain('50/200');
    });

    it('does not log when isFirstSearch is false', () => {
        logProgress({
            scannedFiles: 50,
            totalFiles: 200,
            logEvery: 50,
            matchesFound: 3
        }, false);
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('does not log when scannedFiles is not at logEvery interval', () => {
        // Clear any previous status update
        logStatusClear();
        logStatusUpdate('reset-for-test');
        logSpy.mockClear();

        logProgress({
            scannedFiles: 33,
            totalFiles: 200,
            logEvery: 50,
            matchesFound: 0
        }, true);
        expect(logSpy).not.toHaveBeenCalled();
    });

    it('logs when scannedFiles equals totalFiles', () => {
        logStatusClear();
        logProgress({
            scannedFiles: 100,
            totalFiles: 100,
            logEvery: 50,
            matchesFound: 5
        }, true);
        expect(logSpy).toHaveBeenCalled();
    });
});

// ============================================================================
// Tests — Summary/runtime logging
// ============================================================================

describe('logRuntime', () => {
    it('logs runtime from timer.stop()', () => {
        const mockTimer = { stop: () => '2.5s' };
        logRuntime(mockTimer);
        expect(logSpy).toHaveBeenCalled();
        const output = logSpy.mock.calls[0][0];
        expect(output).toContain('2.5s');
    });
});

describe('logDeletionSummary', () => {
    it('logs deletion stats', () => {
        logDeletionSummary({ deleted: 15, failed: 2, realms: 3 });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('15');
        expect(allOutput).toContain('DELETION SUMMARY');
    });

    it('logs dry-run summary', () => {
        logDeletionSummary({ deleted: 10, failed: 0, realms: 2, dryRun: true });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('DRY-RUN SUMMARY');
        expect(allOutput).toContain('would be deleted');
        expect(allOutput).toContain('dry-run');
    });

    it('logs success message when items deleted', () => {
        logDeletionSummary({ deleted: 5, failed: 0, realms: 1 });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('successfully removed');
    });

    it('logs warning when only failures', () => {
        logDeletionSummary({ deleted: 0, failed: 3, realms: 1 });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('No preferences were deleted');
    });
});

describe('logRestoreSummary', () => {
    it('logs restore stats with realm name', () => {
        logRestoreSummary({ restored: 10, failed: 0, realm: 'EU05' });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('RESTORE SUMMARY');
        expect(allOutput).toContain('10');
        expect(allOutput).toContain('EU05');
    });

    it('logs restore stats with realm count', () => {
        logRestoreSummary({ restored: 5, failed: 1, realm: 3 });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('Realms processed: 3');
    });

    it('logs failure message when only failures', () => {
        logRestoreSummary({ restored: 0, failed: 5, realm: 'EU05' });
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('errors');
    });
});

describe('logBackupClassification', () => {
    it('logs realms with existing backups', () => {
        logBackupClassification(['EU05', 'APAC'], []);
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('EU05');
        expect(allOutput).toContain('APAC');
        expect(allOutput).toContain('EXISTING BACKUP');
    });

    it('logs realms needing backup', () => {
        logBackupClassification([], ['GB', 'PNA']);
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('GB');
        expect(allOutput).toContain('PNA');
        expect(allOutput).toContain('needing backup');
    });

    it('logs both sections when both exist', () => {
        logBackupClassification(['EU05'], ['GB']);
        const allOutput = logSpy.mock.calls.map(c => c[0]).join(' ');
        expect(allOutput).toContain('EU05');
        expect(allOutput).toContain('GB');
    });
});
