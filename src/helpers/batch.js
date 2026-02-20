/**
 * Batch Processing Utilities
 * Handles parallel batch processing with progress tracking and rate limiting
 */



/**
 * Process a single item with automatic retry and exponential backoff
 * @param {*} item - Item to process
 * @param {Function} processFn - Async function to process the item
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 * @param {number} initialDelay - Initial delay in ms (default: 1000)
 * @returns {Promise<*>} Result or null if all retries failed
 */
async function processItemWithRetry(item, processFn, maxRetries = 3, initialDelay = 1000) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await processFn(item);
        } catch (error) {
            // Check if error is retryable
            const statusCode = error.response?.status;
            const isRetryable = [408, 429, 503, 504, 529].includes(statusCode) || !statusCode;

            // Don't retry if we've exhausted attempts or error is not retryable
            if (attempt >= maxRetries || (statusCode && !isRetryable)) {
                return null; // Return null for failed items instead of throwing
            }

            // Calculate delay with exponential backoff
            const delay = Math.min(initialDelay * Math.pow(2, attempt), 30000);

            // Wait before retrying
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }

    return null;
}

/**
 * Process items in parallel batches with callback and per-item retry logic
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {Array} items - Array of items to process
 * @param {Function} processFn - Async function to process each item
 * @param {number} batchSize - Number of items to process in parallel
 * @param {Function} onProgress - Optional callback(current, total, rate) for progress tracking
 * @param {number} delayMs - Optional delay in milliseconds between batches (default: 0)
 * @param {Object} retryOptions - Optional retry configuration
 * @param {number} retryOptions.maxRetries - Max retries per item (default: 3)
 * @param {number} retryOptions.initialDelay - Initial retry delay in ms (default: 1000)
 * @returns {Promise<Array>} Array of results from processing (filters out nulls from failed retries)
 */
export async function processBatch(
    items,
    processFn,
    batchSize = 10,
    onProgress = null,
    delayMs = 0,
    retryOptions = {}
) {
    const {
        maxRetries = 3,
        initialDelay = 1000
    } = retryOptions;

    const results = [];
    const startTime = Date.now();

    for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, i + batchSize);

        // Process each item in batch with retry logic
        const batchPromises = batch.map(item =>
            processItemWithRetry(item, processFn, maxRetries, initialDelay)
        );

        const batchResults = await Promise.allSettled(batchPromises);

        // Collect successful results
        for (const result of batchResults) {
            if (result.status === 'fulfilled' && result.value !== null) {
                results.push(result.value);
            }
        }

        // Update progress
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
 * Execute a function with automatic retry and exponential backoff for rate limiting and temporary failures
 * See .github/instructions/function-reference.md for detailed documentation
 * @param {Function} fn - Async function to execute
 * @param {Object} options - Configuration options
 * @param {number} options.maxRetries - Maximum number of retry attempts (default: 3)
 * @param {number} options.initialDelay - Initial delay in ms before first retry (default: 10000)
 * @param {number} options.maxDelay - Maximum delay in ms between retries (default: 60000)
 * @param {boolean} options.exponential - Use exponential backoff (default: true)
 * @param {Function} options.onRetry - Optional callback(attempt, delay, error) when retrying
 * @param {Array<number>} options.retryableStatuses - HTTP status codes to retry on (default: [429, 503, 504])
 * @returns {Promise<*>} Result from successful function execution
 */
export async function withLoadShedding(fn, options = {}) {
    const {
        maxRetries = 3,
        initialDelay = 10000,
        maxDelay = 60000,
        exponential = true,
        onRetry = null,
        retryableStatuses = [429, 503, 504, 529]
    } = options;

    let lastError;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;

            // Check if error is retryable (rate limit, service unavailable, gateway timeout)
            const statusCode = error.response?.status;
            const isRetryable = retryableStatuses.includes(statusCode);
            const isNetworkError = !statusCode && error.code && error.code !== 'ENOTFOUND';

            // Don't retry if we've exhausted attempts or error is not retryable
            if (attempt >= maxRetries || (!isRetryable && !isNetworkError)) {
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
