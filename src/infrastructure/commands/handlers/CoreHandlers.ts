import { Command } from '../types.js';
import { randomUUID } from 'node:crypto';

/**
 * /pause — Halts the FSM loop for a task.
 */
export const pauseCommand: Command = {
  name: 'pause',
  description: 'Pause the FSM loop for this task.',
  adminOnly: true,
  execute: async (ctx) => {
    ctx.task.status = 'PAUSED';
    ctx.task.thread.messages.push({
      id: randomUUID(),
      author: 'RALPH',
      intent: 'STATUS_UPDATE',
      body: '⏸️ **Agent Paused:** I will not take further autonomous actions until explicitly resumed with `/resume`.',
      timestamp: new Date().toISOString()
    });
    await ctx.storageEngine.commitTaskRecord(ctx.task);
    
    // Sync status to ledger
    const ledger = await ctx.storageEngine.getLedger();
    const summary = ledger.tasks.find(t => t.id === ctx.task.id);
    if (summary) {
      summary.status = 'PAUSED';
      await ctx.storageEngine.commitLedger(ledger);
    }
  },
};

/**
 * /resume — Continues the FSM loop.
 */
export const resumeCommand: Command = {
  name: 'resume',
  description: 'Resume the FSM loop for this task.',
  adminOnly: true,
  execute: async (ctx) => {
    ctx.task.status = 'IN_PROGRESS';
    ctx.task.thread.messages.push({
      id: randomUUID(),
      author: 'RALPH',
      intent: 'STATUS_UPDATE',
      body: '▶️ **Agent Resumed:** I am continuing from my current state.',
      timestamp: new Date().toISOString()
    });
    await ctx.storageEngine.commitTaskRecord(ctx.task);

    // Sync status to ledger
    const ledger = await ctx.storageEngine.getLedger();
    const summary = ledger.tasks.find(t => t.id === ctx.task.id);
    if (summary) {
      summary.status = 'IN_PROGRESS';
      await ctx.storageEngine.commitLedger(ledger);
    }
  },
};

/**
 * /reset — Resets the FSM to INVESTIGATE and clears context.
 */
export const resetCommand: Command = {
  name: 'reset',
  description: 'Reset the state machine for this task.',
  adminOnly: true,
  execute: async (ctx) => {
    ctx.task.context.currentStep = (await import('../../storage/types.js')).FsmStep.INVESTIGATE;
    ctx.task.status = 'OPEN';
    ctx.task.thread.messages.push({
      id: randomUUID(),
      author: 'RALPH',
      intent: 'STATUS_UPDATE',
      body: '🔄 **State Reset:** I have reset my internal state and will start fresh from investigation.',
      timestamp: new Date().toISOString()
    });
    await ctx.storageEngine.commitTaskRecord(ctx.task);

    // Sync status to ledger
    const ledger = await ctx.storageEngine.getLedger();
    const summary = ledger.tasks.find(t => t.id === ctx.task.id);
    if (summary) {
      summary.status = 'OPEN';
      await ctx.storageEngine.commitLedger(ledger);
    }
  },
};
