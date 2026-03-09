import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ============================================================================
// Tests
// ============================================================================

import { validateRealmsSelection } from '../../../src/commands/preferences/helpers/realmHelpers.js';

beforeEach(() => {
    vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
    vi.restoreAllMocks();
});

describe('validateRealmsSelection', () => {
    it('returns true for valid non-empty array', () => {
        expect(validateRealmsSelection(['EU05', 'APAC'])).toBe(true);
    });

    it('returns false for empty array', () => {
        expect(validateRealmsSelection([])).toBe(false);
    });

    it('returns false for null', () => {
        expect(validateRealmsSelection(null)).toBe(false);
    });

    it('returns false for undefined', () => {
        expect(validateRealmsSelection(undefined)).toBe(false);
    });

    it('logs message when invalid', () => {
        validateRealmsSelection([]);
        expect(console.log).toHaveBeenCalledWith(
            'No realms found for the selected scope.'
        );
    });

    it('does not log when valid', () => {
        validateRealmsSelection(['EU05']);
        expect(console.log).not.toHaveBeenCalled();
    });
});
