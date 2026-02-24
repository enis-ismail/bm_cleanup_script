import path from 'path';
import fs from 'fs/promises';
import { getBackupConfig, getWebdavConfig } from '../index.js';
import { triggerJobExecution, getJobExecutionStatus, downloadWebdavFile } from '../api/api.js';

/**
 * Build a safe file name for metadata backups.
 * Includes the hostname and current date for traceability.
 * @param {string} realmHostname - Realm hostname
 * @returns {string} File name
 */
export function buildMetadataBackupFileName(realmHostname) {
    const safeHost = String(realmHostname || 'unknown').replace(/[^A-Za-z0-9.-]/g, '-');
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    return `${safeHost}_meta_data_backup_${date}.xml`;
}

/**
 * Determine whether a job execution has reached a terminal state.
 * SFCC OCAPI returns:
 *   execution_status: "pending" | "running" | "finished" | "aborted"
 *   exit_status:      { status: "ok" | "error" }  (only present when finished)
 *
 * @param {Object} response - OCAPI job execution response
 * @returns {{ done: boolean, ok: boolean }} done=true when terminal; ok=true when successful
 * @private
 */
function resolveJobTerminalState(response) {
    const execStatus = (response.execution_status || response.status || '').toLowerCase();

    // Still running — not terminal
    if (execStatus === 'pending' || execStatus === 'running') {
        return { done: false, ok: false };
    }

    // Aborted — terminal failure
    if (execStatus === 'aborted') {
        return { done: true, ok: false };
    }

    // Finished — check exit_status for success or error
    if (execStatus === 'finished') {
        const exitStatus = typeof response.exit_status === 'object'
            ? (response.exit_status.status || '').toLowerCase()
            : (response.exit_status || '').toLowerCase();

        return { done: true, ok: exitStatus === 'ok' };
    }

    // Unknown status — treat as terminal failure
    return { done: true, ok: false };
}

/**
 * Poll job status until completion or timeout
 * @param {Object} params - Poll parameters
 * @returns {Promise<{status: string, ok: boolean, statusResponse: Object|null}>}
 * @private
 */
async function pollJobStatus(params) {
    const {
        jobId,
        executionId,
        realm,
        ocapiVersion,
        pollIntervalMs,
        timeoutMs
    } = params;
    const pollStart = Date.now();

    while (true) {
        const statusResponse = await getJobExecutionStatus(
            jobId,
            executionId,
            realm,
            ocapiVersion
        );

        if (!statusResponse) {
            return { status: 'ERROR', ok: false, statusResponse: null };
        }

        const terminal = resolveJobTerminalState(statusResponse);

        if (terminal.done) {
            const label = terminal.ok ? 'OK' : 'FAILED';
            return { status: label, ok: terminal.ok, statusResponse };
        }

        if (Date.now() - pollStart >= timeoutMs) {
            return { status: 'TIMEOUT', ok: false, statusResponse };
        }

        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
}

/**
 * Try to download the existing metadata XML from WebDAV.
 * If the file doesn't exist on the server, trigger a backup job, wait for it,
 * then download. This means manually-triggered jobs in BM are picked up
 * without needing to re-run the job.
 *
 * @param {string} realm - Realm name
 * @param {string} _instanceType - Instance type (unused, reserved for future use)
 * @returns {Promise<{ok: boolean, filePath?: string, status?: string, reason?: string}>}
 */
export async function refreshMetadataBackupForRealm(realm, _instanceType) {
    let backupConfig;
    let webdavConfig;

    try {
        backupConfig = getBackupConfig();
        webdavConfig = getWebdavConfig(realm);
    } catch (configError) {
        return { ok: false, reason: configError.message };
    }

    if (!webdavConfig.username || !webdavConfig.password) {
        return { ok: false, reason: 'Missing WebDAV credentials in config.json' };
    }

    const targetFileName = buildMetadataBackupFileName(webdavConfig.hostname);

    try {
        // --- 1. Try downloading the existing file first ---
        const existingPath = await downloadWebdavFile(
            webdavConfig, backupConfig.outputDir, targetFileName
        );

        if (existingPath) {
            try {
                await fs.access(existingPath);
                return { ok: true, filePath: existingPath, status: 'EXISTING' };
            } catch {
                // Download returned a path but file is missing — fall through
            }
        }

        // --- 2. File not on server — trigger backup job ---
        if (!backupConfig.jobId) {
            return {
                ok: false,
                reason: 'No existing metadata file and no backup.jobId configured'
            };
        }

        const executionResponse = await triggerJobExecution(
            backupConfig.jobId,
            realm,
            backupConfig.ocapiVersion
        );

        if (!executionResponse) {
            return { ok: false, reason: 'Failed to trigger backup job' };
        }

        const executionId = executionResponse.id ||
            executionResponse.execution_id ||
            executionResponse.job_execution_id ||
            null;

        if (!executionId) {
            return {
                ok: false,
                reason: 'Missing execution ID from job response'
            };
        }

        // --- 3. Poll until job reaches a terminal state ---
        const pollResult = await pollJobStatus({
            jobId: backupConfig.jobId,
            executionId,
            realm,
            ocapiVersion: backupConfig.ocapiVersion,
            pollIntervalMs: backupConfig.pollIntervalMs,
            timeoutMs: backupConfig.timeoutMs
        });

        if (!pollResult.ok) {
            return {
                ok: false,
                reason: `Backup job finished with status: ${pollResult.status}`,
                status: pollResult.status
            };
        }

        // --- 4. Download after job completed ---
        const downloadedPath = await downloadWebdavFile(
            webdavConfig, backupConfig.outputDir, targetFileName
        );

        if (!downloadedPath) {
            return {
                ok: false,
                reason: 'Job completed but failed to download metadata XML'
            };
        }

        try {
            await fs.access(downloadedPath);
        } catch {
            return {
                ok: false,
                reason: `Downloaded file not found at ${downloadedPath}`
            };
        }

        return {
            ok: true, filePath: downloadedPath, status: pollResult.status
        };
    } catch (unexpectedError) {
        return {
            ok: false,
            reason: unexpectedError.message || String(unexpectedError)
        };
    }
}

/**
 * Resolve expected metadata backup path for a realm (today's date).
 * @param {string} realm - Realm name
 * @returns {string} Expected metadata file path
 */
export function getMetadataBackupPathForRealm(realm) {
    const backupConfig = getBackupConfig();
    const webdavConfig = getWebdavConfig(realm);
    const fileName = buildMetadataBackupFileName(webdavConfig.hostname);
    return path.join(backupConfig.outputDir, fileName);
}
