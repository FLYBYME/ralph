import { TaskRecord, FsmStep, ProjectRecord } from '../storage/types.js';
import { ILlmProvider } from '../llm/types.js';
import { PromptBuilder } from '../llm/PromptBuilder.js';
import { WorkerManager } from '../llm/WorkerManager.js';
import { CommandManager } from '../commands/CommandManager.js';
import * as crypto from 'crypto';
import { colors, color, dim } from '../../utils/colors.js';

export interface AnalysisResult {
  interrupted: boolean;
}

/**
 * ContextAnalyzer
 * Analyzes the recent conversation to determine if Ralph should pivot.
 */
export class ContextAnalyzer {
  constructor(
    private readonly workerManager: WorkerManager,
    private readonly provider: ILlmProvider,
    private readonly promptBuilder: PromptBuilder,
    private readonly commandManager: CommandManager
  ) {}

  public async analyzeContext(task: TaskRecord, project: ProjectRecord): Promise<AnalysisResult> {
    const messages = task.thread.messages;

    if (messages.length === 0) {
      return { interrupted: false };
    }

    // Identify latest HUMAN trigger
    const lastHuman = [...messages].reverse().find(c => c.author === 'HUMAN');
    
    if (!lastHuman) {
      return { interrupted: false };
    }

    // Has it been processed?
    if (messages[messages.length - 1]?.id !== lastHuman.id) {
       return { interrupted: false };
    }

    console.log(`${color('[analyzer]', colors.cyan)} 👤 New human activity detected: ${dim(lastHuman.body.slice(0, 60))}...`);

    // 1. Check for slash commands first
    console.log(`${color('[analyzer]', colors.dim)} Checking for commands...`);
    const wasCommand = await this.commandManager.dispatch(lastHuman.body, {
        task,
        project,
        sender: 'admin', // In local mode, everything is admin for now
        timestamp: new Date().toISOString()
    });

    if (wasCommand) {
        console.log(`${color('[analyzer]', colors.green)} ✅ Command executed. Interrupting loop.`);
        return { interrupted: true };
    }

    // 2. LLM Intent Analysis
    console.log(`${color('[analyzer]', colors.dim)} Analyzing intent via LLM...`);
    const settings = await this.commandManager['storageEngine'].getSettings();
    const conversationHistory = messages.map(m => `@${m.author}: ${m.body}`).join('\n');
    const payload = this.promptBuilder.buildContextAnalysisPrompt(task, conversationHistory, lastHuman.body, settings.ollamaModel);
    
    // We expect a JSON response back
    const response = await this.workerManager.dispatch(payload, this.provider, settings.ollamaModel);
    
    let analysis: any = null;
    try {
        if (response.rawText) {
            analysis = JSON.parse(response.rawText);
        }
    } catch (e) {
        console.warn(`${color('[analyzer:warn]', colors.yellow)} Failed to parse LLM intent JSON.`, e);
        return { interrupted: false };
    }

    if (!analysis || !analysis.intent) {
        return { interrupted: false };
    }

    console.log(`${color('[analyzer]', colors.magenta)} 🧠 Intent: ${color(analysis.intent, colors.yellow)} | Reasoning: ${dim(analysis.reasoning)}`);

    // Update Context Stack with references
    if (analysis.detected_references && Array.isArray(analysis.detected_references)) {
      if (!task.context.contextStack) task.context.contextStack = [];
      for (const ref of analysis.detected_references) {
        const exists = task.context.contextStack.some(c => c.ref === ref);
        if (!exists) {
          console.log(`${color('[analyzer]', colors.blue)} 📎 New reference: ${ref}`);
          task.context.contextStack.push({ ref, summary: 'Context to be fetched...' });
        }
      }
    }

    const respond = (text: string) => {
        task.thread.messages.push({
            id: crypto.randomUUID(),
            author: 'RALPH',
            intent: 'STATUS_UPDATE',
            body: text,
            timestamp: new Date().toISOString()
        });
    };

    switch (analysis.intent) {
      case 'IGNORE':
        console.log(`${color('[analyzer]', colors.dim)} Intent is IGNORE. Continuing.`);
        return { interrupted: false };

      case 'QUESTION':
        console.log(`${color('[analyzer]', colors.green)} Intent is QUESTION. Responding.`);
        respond(`💬 **Ralph:** ${analysis.suggested_reply || "I'm not sure about that based on my investigation."}`);
        return { interrupted: true };

      case 'INSTRUCTION':
        console.log(`${color('[analyzer]', colors.green)} Intent is INSTRUCTION. Refocusing.`);
        respond(`🕵️‍♂️ Understood. I've updated my notes with your feedback and I'm refocusing.`);
        task.context.currentStep = FsmStep.PLAN;
        task.context.investigation.notes = (task.context.investigation.notes || '') + `\n\n[ADMIN UPDATE]: ${lastHuman.body}`;
        return { interrupted: true };

      case 'APPROVAL':
        if (task.context.currentStep === FsmStep.AWAITING_REVIEW || task.status === 'AWAITING_REVIEW') {
          console.log(`${color('[analyzer]', colors.green)} Intent is APPROVAL. Advancing to EXECUTE.`);
          task.context.currentStep = FsmStep.EXECUTE;
          task.status = 'IN_PROGRESS';
          respond(`🚀 Approval granted. Moving to execution phase.`);
          return { interrupted: true };
        }
        console.log(`${color('[analyzer]', colors.yellow)} Intent is APPROVAL but state is not AWAITING_REVIEW. Ignoring.`);
        break;

      case 'REJECT':
        console.log(`${color('[analyzer]', colors.red)} Intent is REJECT. Returning to investigation.`);
        respond(`🛑 Feedback received. Returning to investigation stage.`);
        task.context.currentStep = FsmStep.INVESTIGATE;
        task.status = 'IN_PROGRESS';
        task.context.investigation.notes = (task.context.investigation.notes || '') + `\n\n[ADMIN REJECTED PLAN]: ${lastHuman.body}`;
        return { interrupted: true };

      case 'FAST_TRACK':
        console.log(`${color('[analyzer]', colors.green)} Intent is FAST_TRACK. Skipping to EXECUTE.`);
        task.context.currentStep = FsmStep.EXECUTE;
        task.status = 'IN_PROGRESS';
        task.context.execution.geminiPrompt = lastHuman.body;
        respond(`⚡ Fast-tracking task based on your instructions.`);
        return { interrupted: true };
    }

    return { interrupted: false };
  }
}
