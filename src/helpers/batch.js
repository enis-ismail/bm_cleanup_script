/**
 * Batch Processing Utilities
 * Handles parallel batch processing with progress tracking and rate limiting
 */

/* eslint-disable no-undef */

/**
 * Process items in parallel batches with callback
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {Array} items - Array of items to process
 * @param {Function} processFn - Async function to process each item
 * @param {number} batchSize - Number of items to process in parallel
 * @param {Function} onProgress - Optional callback(current, total, rate) for progress tracking
 * @param {number} delayMs - Optional delay in milliseconds between batches (default: 0)
 * @returns {Promise<Array>} Array of results from processing
 */
export async function processBatch(items, processFn, batchSize = 10, onProgress = null, delayMs = 0) {
    const results = [];
    const startTime = Date.now();

    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);
        const batchPromises = batch.map(item => processFn(item));
        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults.filter(r => r !== null));

        const progress = Math.min(i + batchSize, items.length);
        if (onProgress) {
            const elapsed = Date.now() - startTime;
            const rate = progress / (elapsed / 1000);
            onProgress(progress, items.length, rate);
        }

        // Add delay between batches if specified and not the last batch
        if (delayMs > 0 && i + batchSize < items.length) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }

    return results;
}

/**
 * Execute a function with automatic retry and exponential backoff for rate limiting
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Configuration options
 * @param {number} options.maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms before first retry (default: 2000)
 * @param {number} options.maxDelay - Maximum delay in ms between retries (default: 60000)
 * @param {boolean} options.exponential - Use exponential backoff (default: true)
 * @param {Function} options.onRetry - Optional callback(attempt, delay, error) when retrying
 * @returns {Promise<*>} Result from successful function execution
 */
export async function withLoadShedding(fn, options = {}) {
    const {
        maxRetries = 3,
        initialDelay = 2000,
        maxDelay = 60000,
        exponential = true,
        onRetry = null
    } = options;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Check if it's a rate limit error (429)
            const isRateLimited = error.response?.status === 429;

            // Don't retry if we've exhausted attempts or it's not a rate limit error
            if (attempt >= maxRetries || !isRateLimited) {
                throw error;
            }

            // Calculate delay with exponential backoff
            const delay = exponential
                ? Math.min(initialDelay * Math.pow(2, attempt), maxDelay)
                : initialDelay;

            // Notify about retry if callback provided
            if (onRetry) {
                onRetry(attempt + 1, delay, error);
            }

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    throw lastError;
}
