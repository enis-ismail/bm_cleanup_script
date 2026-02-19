import path from 'path';
import fs from 'fs/promises';
import { getBackupConfig, getWebdavConfig } from '../index.js';
import { triggerJobExecution, getJobExecutionStatus, downloadWebdavFile } from '../api/api.js';

/**
 * Build a safe file name for metadata backups
 * @param {string} instanceType - Instance type
 * @param {string} realmHostname - Realm hostname
 * @returns {string} File name
 */
export function buildMetadataBackupFileName(instanceType, realmHostname) {
    const safeHost = String(realmHostname || '').replace(/[^A-Za-z0-9.-]/g, '-');
    const safeInstance = String(instanceType || '').replace(/[^A-Za-z0-9.-]/g, '-');
    return `${safeInstance}_${safeHost}_meta_data_backup.xml`;
}

/**
 * Resolve metadata backup file path (overwrites existing file)
 * @param {string} outputDir - Output directory
 * @param {string} fileName - Desired file name
 * @returns {Promise<string>} File path
 * @private
 */
async function resolveUniqueMetadataPath(outputDir, fileName) {
    const outputPath = path.join(outputDir, fileName);
    return outputPath;
}

/**
 * Poll job status until completion or timeout
 * @param {Object} params - Poll parameters
 * @returns {Promise<{status: string, statusResponse: Object|null}>}
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
    let statusResponse;
    let status;

    while (true) {
        statusResponse = await getJobExecutionStatus(
            jobId,
            executionId,
            realm,
            ocapiVersion
        );

        if (!statusResponse) {
            return { status: 'ERROR', statusResponse: null };
        }

        status = statusResponse.status ||
            statusResponse.execution_status ||
            statusResponse.exit_status ||
            'UNKNOWN';

        if (status === 'OK' || status === 'FINISHED' || status === 'COMPLETED') {
            return { status, statusResponse };
        }

        if (status === 'ERROR' || status === 'FAILED' || status === 'ABORTED') {
            return { status, statusResponse };
        }

        if (Date.now() - pollStart >= timeoutMs) {
            return { status: 'TIMEOUT', statusResponse };
        }

        await new Promise(resolve => setTimeout(resolve, pollIntervalMs));
    }
}

/**
 * Trigger a backup job, download the metadata XML, and rename it
 * @param {string} realm - Realm name
 * @param {string} instanceType - Instance type
 * @returns {Promise<{ok: boolean, filePath?: string, status?: string, reason?: string}>}
 */
export async function refreshMetadataBackupForRealm(realm, instanceType) {
    const backupConfig = getBackupConfig();
    const webdavConfig = getWebdavConfig(realm);
    let executionResponse;
    let executionId;
    let pollResult;
    let downloadedPath;
    let fileName;
    let targetPath;

    if (!backupConfig.jobId) {
        return { ok: false, reason: 'Missing backup.jobId in config.json' };
    }

    if (!webdavConfig.username || !webdavConfig.password) {
        return { ok: false, reason: 'Missing WebDAV credentials in config.json' };
    }

    executionResponse = await triggerJobExecution(
        backupConfig.jobId,
        realm,
        backupConfig.ocapiVersion
    );

    if (!executionResponse) {
        return { ok: false, reason: 'Failed to trigger backup job' };
    }

    executionId = executionResponse.id ||
        executionResponse.execution_id ||
        executionResponse.job_execution_id ||
        null;

    if (!executionId) {
        return { ok: false, reason: 'Missing execution ID from job response' };
    }

    pollResult = await pollJobStatus({
        jobId: backupConfig.jobId,
        executionId,
        realm,
        ocapiVersion: backupConfig.ocapiVersion,
        pollIntervalMs: backupConfig.pollIntervalMs,
        timeoutMs: backupConfig.timeoutMs
    });

    if (pollResult.status === 'TIMEOUT') {
        return { ok: false, reason: 'Job polling timed out', status: pollResult.status };
    }

    if (pollResult.status !== 'OK' && pollResult.status !== 'FINISHED' && pollResult.status !== 'COMPLETED') {
        return { ok: false, reason: 'Job failed', status: pollResult.status };
    }

    downloadedPath = await downloadWebdavFile(webdavConfig, backupConfig.outputDir);

    if (!downloadedPath) {
        return { ok: false, reason: 'Failed to download metadata XML' };
    }

    fileName = buildMetadataBackupFileName(instanceType, webdavConfig.hostname);
    targetPath = await resolveUniqueMetadataPath(backupConfig.outputDir, fileName);

    if (downloadedPath !== targetPath) {
        await fs.rename(downloadedPath, targetPath);
    }

    return { ok: true, filePath: targetPath, status: pollResult.status };
}

/**
 * Resolve expected metadata backup path for a realm
 * @param {string} realm - Realm name
 * @param {string} instanceType - Instance type
 * @returns {string} Expected metadata file path
 */
export function getMetadataBackupPathForRealm(realm, instanceType) {
    const backupConfig = getBackupConfig();
    const webdavConfig = getWebdavConfig(realm);
    const fileName = buildMetadataBackupFileName(instanceType, webdavConfig.hostname);
    return path.join(backupConfig.outputDir, fileName);
}
