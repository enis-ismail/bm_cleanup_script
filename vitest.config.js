import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: true,
        testTimeout: 10000,
        include: ['tests/**/*.test.js'],
        coverage: {
            include: ['src/**/*.js']
        }
    }
});
