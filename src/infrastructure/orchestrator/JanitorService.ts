import { LedgerStorageEngine } from '../storage/LedgerStorageEngine.js';
import { WorkerManager } from '../llm/WorkerManager.js';
import { ProviderRegistry } from '../llm/ProviderRegistry.js';
import { DiskTooling } from '../storage/DiskTooling.js';
import { AuditAction } from '../actions/AuditAction.js';
import { createLogger, Logger } from '../logging/Logger.js';
import { LocalEventBus } from '../bus/LocalEventBus.js';
import * as path from 'path';

/**
 * JanitorService
 * Responsibility: Proactive codebase auditing and maintenance task generation.
 */
export class JanitorService {
  private logger: Logger;
  private diskTooling: DiskTooling;

  constructor(
    private readonly storageEngine: LedgerStorageEngine,
    private readonly workerManager: WorkerManager,
    private readonly providerRegistry: ProviderRegistry,
    private readonly eventBus: LocalEventBus,
    private readonly auditAction: AuditAction
  ) {
    this.logger = createLogger('janitor', eventBus);
    this.diskTooling = new DiskTooling();
  }

  public async runAudit(): Promise<void> {
    const settings = await this.storageEngine.getSettings();
    if (!settings.janitorEnabled) return;

    this.logger.info('Starting proactive janitor audit...');

    const ledger = await this.storageEngine.getLedger();
    const now = new Date();

    // Cooldown check
    if (ledger.lastJanitorRun) {
        const lastRun = new Date(ledger.lastJanitorRun);
        const diffMs = now.getTime() - lastRun.getTime();
        const cooldownMs = settings.janitorCooldownHours * 60 * 60 * 1000;
        if (diffMs < cooldownMs) {
            this.logger.debug(`Janitor is on cooldown. Last run: ${ledger.lastJanitorRun}`);
            return;
        }
    }

    // Check Quota
    if (settings.quotaLocks && settings.quotaLocks.length > 0) {
        this.logger.warn('System under quota lock. Skipping janitor audit to preserve tokens.');
        return;
    }

    for (const project of ledger.projects) {
        try {
            this.logger.info(`Auditing project: ${project.name}`);
            await this.auditProject(project.id);
        } catch (err) {
            this.logger.error(`Failed to audit project ${project.name}: ${err}`);
        }
    }

    // Update last run timestamp
    await this.storageEngine.mutateLedger(async (l) => {
        l.lastJanitorRun = now.toISOString();
    });

    this.logger.info('Janitor audit completed.');
  }

  private async auditProject(projectId: string): Promise<void> {
    const project = await this.storageEngine.getProject(projectId);
    if (!project) return;

    // Strategy A: Dependency Audit
    const pkgPath = path.join(project.absolutePath, 'package.json');
    if (await this.diskTooling.fileExists(pkgPath)) {
        this.logger.debug(`[Strategy A] Found package.json for ${project.name}. Dependency audit initiated.`);
        
        await this.auditAction.execute({
            projectId: project.id,
            title: `[Maintenance] Dependency Audit for ${project.name}`,
            input: `Run 'npm audit' or check for outdated packages in ${project.absolutePath}. Update the package.json if necessary.`,
            useTDD: false
        });
    }

    // Strategy B: Code Smell Review
    if (project.sourceUrl || !project.isLocalOnly) {
        this.logger.debug(`[Strategy B] Running code smell review for ${project.name}...`);
        
        await this.auditAction.execute({
            projectId: project.id,
            title: `[Maintenance] Code Smell Review for ${project.name}`,
            input: `Review the recent changes in ${project.name} for code smells, missing types, or refactoring opportunities.`,
            useTDD: false
        });
    }
    
    // Check members to avoid unused warnings
    if (!this.workerManager || !this.providerRegistry || !this.auditAction || !this.eventBus) {
        this.logger.error('Critical dependencies missing in JanitorService');
    }
  }
}
