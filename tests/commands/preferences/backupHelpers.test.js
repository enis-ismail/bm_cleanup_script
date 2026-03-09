import { describe, it, expect } from 'vitest';
import { validateAndCorrectBackup } from '../../../src/commands/preferences/helpers/backupHelpers.js';

// ============================================================================
// validateAndCorrectBackup
// ============================================================================

describe('validateAndCorrectBackup', () => {
    it('returns uncorrected for a valid backup', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_enableFeature',
                    display_name: { default: 'Enable Feature' },
                    description: { default: 'Desc' },
                    default_value: { value: true },
                    value_type: 'boolean'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(false);
        expect(result.corrections).toEqual([]);
        expect(result.backup.attributes[0].display_name).toEqual({ default: 'Enable Feature' });
    });

    it('converts string display_name to object format', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_pref1',
                    display_name: 'My Preference',
                    value_type: 'string'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].display_name).toEqual({ default: 'My Preference' });
        expect(result.corrections.some(c => c.includes('display_name'))).toBe(true);
    });

    it('converts string description to object format', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_pref2',
                    description: 'A description',
                    value_type: 'string'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].description).toEqual({ default: 'A description' });
    });

    it('cleans xml2js artifacts from description and converts _ to default', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_pref3',
                    description: { _: 'xml content', $: { attr: 'val' } },
                    value_type: 'string'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        // The _ value is converted to { default: 'xml content' }
        expect(result.backup.attributes[0].description).toEqual({ default: 'xml content' });
    });

    it('converts string default_value to typed {value: <typed>} for boolean', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_flag',
                    default_value: 'true',
                    value_type: 'boolean'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].default_value).toEqual({ value: true });
    });

    it('converts string default_value to typed {value: <typed>} for int', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_count',
                    default_value: '42',
                    value_type: 'int'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].default_value).toEqual({ value: 42 });
    });

    it('converts string default_value to typed {value: <typed>} for double', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_rate',
                    default_value: '3.14',
                    value_type: 'double'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].default_value).toEqual({ value: 3.14 });
    });

    it('keeps string default_value as string type when value_type is string', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_label',
                    default_value: 'hello',
                    value_type: 'string'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].default_value).toEqual({ value: 'hello' });
    });

    it('cleans xml2js artifacts from default_value object', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_setting',
                    default_value: { _: '10', $: { type: 'int' } },
                    value_type: 'integer'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].default_value).toEqual({ value: 10 });
    });

    it('converts default_value with "default" key to {value: <typed>}', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_val',
                    default_value: { default: 'false' },
                    value_type: 'boolean'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0].default_value).toEqual({ value: false });
    });

    it('removes xml2js root-level artifacts from attributes', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_dirty',
                    _: 'text',
                    $: { xmlns: 'http://example.com' },
                    value_type: 'string'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        expect(result.backup.attributes[0]._).toBeUndefined();
        expect(result.backup.attributes[0].$).toBeUndefined();
    });

    it('handles multiple attributes with mixed issues', () => {
        const backup = {
            attributes: [
                {
                    id: 'c_valid',
                    display_name: { default: 'Valid' },
                    value_type: 'string'
                },
                {
                    id: 'c_fixMe',
                    display_name: 'Fix Me',
                    description: 'Needs fix',
                    default_value: '100',
                    value_type: 'int'
                }
            ]
        };

        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(true);
        // First attribute should be unchanged
        expect(result.backup.attributes[0].display_name).toEqual({ default: 'Valid' });
        // Second should be corrected
        expect(result.backup.attributes[1].display_name).toEqual({ default: 'Fix Me' });
        expect(result.backup.attributes[1].description).toEqual({ default: 'Needs fix' });
        expect(result.backup.attributes[1].default_value).toEqual({ value: 100 });
    });

    it('does not mutate the original backup object', () => {
        const original = {
            attributes: [
                {
                    id: 'c_pref',
                    display_name: 'String Name',
                    value_type: 'string'
                }
            ]
        };

        validateAndCorrectBackup(original);

        // Original should still be a string
        expect(original.attributes[0].display_name).toBe('String Name');
    });

    it('handles empty attributes array', () => {
        const backup = { attributes: [] };
        const result = validateAndCorrectBackup(backup);

        expect(result.corrected).toBe(false);
        expect(result.corrections).toEqual([]);
    });
});
