import { z } from 'zod';
import { TaskRecord, ProjectRecord } from '../storage/types.js';
import { WorkerPayload, FileContext } from './types.js';

export const ContextAnalysisSchema = z.object({
  intent: z.enum(["QUESTION", "INSTRUCTION", "APPROVAL", "REJECT", "FAST_TRACK", "IGNORE"]),
  detected_references: z.array(z.string()).optional(),
  reasoning: z.string(),
  suggested_reply: z.string().optional()
});

export const SelfReviewSchema = z.object({
  is_satisfactory: z.boolean(),
  notes: z.string(),
  commit_message: z.string(),
  diff_summary: z.string()
});

export const JudgeScorecardSchema = z.object({
  score: z.number().min(0).max(100),
  feedback: z.string(),
  status: z.enum(["PASSED", "FAILED"])
});

export interface ChatPromptOptions {
  issueTitle: string;
  issueBody: string;
  commentThread: Array<{ user: string; body: string }>;
  command: string;
  isPullRequest: boolean;
}

export interface CommitInfo {
  sha: string;
  message: string;
  author: string | null;
}

/**
 * PromptBuilder
 * Responsibility: Slices memory into optimized prompt strings.
 */
export class PromptBuilder {
  
  // ─── Phase 1 ─────────────────────────────────────────────────────────

  /**
   * Phase 1 — Simple one-sentence issue summary.
   */
  public buildSummaryPrompt(title: string, body: string): string {
    return `Summarize the following GitHub issue in exactly one concise sentence. 

Issue Title: "${title}"

Issue Body:
---
${body || '(no body provided)'}
---

Provide ONLY the one-sentence summary. Do not include introductory text, greetings, or explanations.`;
  }

  // ─── Phase 2 ─────────────────────────────────────────────────────────

  /**
   * Phase 2 — Triage prompt: returns a JSON object with category and reasoning.
   */
  public buildTriagePrompt(title: string, body: string): string {
    return `You are a senior software engineer performing GitHub issue triage.

Analyze the following GitHub issue and classify it into exactly ONE of these categories:
- "bug": A defect, crash, unexpected behavior, or regression
- "enhancement": A new feature request or improvement to existing functionality  
- "question": A usage question, clarification request, or how-to inquiry
- "documentation": A request to improve or fix documentation
- "other": Anything that doesn't fit the categories above

Issue Title: "${title}"

Issue Body:
---
${body || '(no body provided)'}
---

Respond with a JSON object in this exact format:
{
  "category": "<one of: bug, enhancement, question, documentation, other>",
  "confidence": <float between 0.0 and 1.0>,
  "reasoning": "<one sentence explaining your classification>"
}

CRITICAL: Output ONLY valid JSON. Do not wrap the response in markdown blocks (e.g., \`\`\`json) and do not include any other text.`;
  }

  /**
   * Phase 2 — Pull Request review prompt: returns a JSON object with findings.
   */
  public buildPRReviewPrompt(
    title: string,
    body: string,
    diff: string
  ): string {
    const maxDiffChars = 8000;
    const truncatedDiff =
      diff.length > maxDiffChars
        ? `${diff.slice(0, maxDiffChars)}\n\n... [diff truncated at ${maxDiffChars} chars]`
        : diff;

    return `You are an expert, rigorous code reviewer. Analyze the following pull request diff and identify logic flaws, security vulnerabilities, performance bottlenecks, or major code quality problems. Ignore trivial formatting issues.

PR Title: "${title}"

PR Description:
---
${body || '(no description provided)'}
---

Diff:
\`\`\`diff
${truncatedDiff}
\`\`\`

Respond with a JSON object in this exact format:
{
  "summary": "<one paragraph overall assessment of the PR's impact and quality>",
  "severity": "<overall severity of findings: low, medium, or high>",
  "findings": [
    {
      "type": "<logic-flaw | security | performance | style | maintainability>",
      "description": "<specific details of the issue found in the diff>",
      "suggestion": "<actionable recommendation to fix or improve it>"
    }
  ]
}

If there are no significant issues, return an empty findings array [] and "low" severity.
CRITICAL: Output ONLY valid JSON. Do not wrap the response in markdown blocks (e.g., \`\`\`json).`;
  }

  // ─── Phase 3 ─────────────────────────────────────────────────────────

  /**
   * Phase 3 — ChatOps prompt: answer a focused @agent question with thread context.
   */
  public buildChatPrompt(opts: ChatPromptOptions): string {
    const threadText =
      opts.commentThread.length === 0
        ? '(no prior comments)'
        : opts.commentThread
          .map((c) => `**@${c.user}:** ${c.body.slice(0, 500)}`)
          .join('\n\n');

    const context = opts.isPullRequest ? 'Pull Request' : 'Issue';

    return `You are an expert AI assistant helping developers with a GitHub ${context}. 

## Target ${context} Context
**Title:** ${opts.issueTitle}
**Description:**
${opts.issueBody ? opts.issueBody.slice(0, 1000) : '(None)'}

## Recent Comment Thread
${threadText}

## User Command
${opts.command}

## Instructions
1. Respond helpfully and concisely to the User Command.
2. Rely strictly on the context provided above. Do not hallucinate code or facts.
3. If asked to explain code, be highly specific.
4. If asked for a fix, provide concrete, formatted code snippets.`;
  }

  /**
   * Phase 3 — ReAct system prompt for autonomous issue solving.
   */
  public buildSolveSystemPrompt(
    repoMapStr: string,
    toolSchemasStr: string
  ): string {
    return `You are an autonomous, expert AI software engineer. Your objective is to analyze a GitHub issue, navigate the codebase, and propose a concrete code fix by opening a Pull Request.

You operate in a strict Reason + Act loop. You MUST use the provided tools to interact with the system. Every response you generate MUST be valid JSON in one of these two exact formats:

**FORMAT 1: TO CALL A TOOL**
\`\`\`json
{
  "thought": "<detailed reasoning about what you need to do next and why>",
  "action": "<exact tool name from the list below>",
  "parameters": { "<param_name>": "<value>" }
}
\`\`\`

**FORMAT 2: TO FINISH THE TASK**
\`\`\`json
{
  "thought": "<final reasoning summarizing your actions>",
  "final_answer": "<a concise, human-readable explanation of the fix and the PR opened>"
}
\`\`\`

## Critical Rules:
1. NEVER guess file paths or contents. Use directory listing and search tools to explore.
2. You MUST read relevant files BEFORE attempting to write any code.
3. Write COMPLETE file contents when using \`writeFile\` — never use placeholders or partial truncated code.
4. If you cannot confidently fix the issue, use FORMAT 2 and set \`final_answer\` explaining the blockers.
5. Only use the tools provided in the schema below.

## Available Tools
${toolSchemasStr}

## Repository Map
${repoMapStr}`;
  }

  /**
   * Phase 3 — Initial user prompt for the solve ReAct loop.
   */
  public buildSolveTaskPrompt(
    issueTitle: string,
    issueBody: string,
    issueNumber: number | string
  ): string {
    const label = typeof issueNumber === 'string' ? 'Local Task' : `Issue #${issueNumber}`;
    return `Your task is to investigate and fix the following ${label}.

**${label}:** ${issueTitle}

**Description:**
---
${issueBody || '(no description provided)'}
---

**Instructions:**
1. Start by searching the codebase or listing the directory to find relevant files.
2. Read the key files to understand the current implementation.
3. Create a new branch, write the corrected full file contents, and open a pull request.
4. Conclude your loop using the \`final_answer\` format.`;
  }

  /**
   * Phase 3 — Changelog generation prompt for automated releases.
   */
  public buildChangelogPrompt(
    commits: CommitInfo[],
    fromVersion: string,
    toVersion: string
  ): string {
    const commitLines = commits
      .map((c) => `- ${c.sha} ${c.message}${c.author ? ` (${c.author})` : ''}`)
      .join('\n');

    return `You are an expert technical writer generating a clear, developer-friendly software release changelog.

Analyze the following Git commits and produce a structured changelog for version ${toVersion} (updating from ${fromVersion}).

Commits:
---
${commitLines}
---

Group the changes into semantic sections. Use these exact section headers if relevant: "✨ Features", "🐛 Bug Fixes", "⚡ Performance", "🔒 Security", "♻️ Refactoring", "📚 Documentation", "🔧 Maintenance". 

Respond with a JSON object in this exact format:
{
  "summary": "<one-paragraph executive summary highlighting the most impactful changes>",
  "breaking_changes": ["<list any breaking changes, or leave as an empty array []>"],
  "sections": {
    "✨ Features": ["<concise item description>", "..."],
    "🐛 Bug Fixes": ["<concise item description>", "..."]
  }
}

CRITICAL: 
1. Only include sections in the JSON that have actual entries.
2. Keep individual items concise (one line each) and human-readable. Omit merge commit noise.
3. Output ONLY valid JSON. Do not wrap the response in markdown blocks (e.g., \`\`\`json).`;
  }

  // ─── Existing Logic ───────────────────────────────────────────────────

  /**
   * Focuses on discovery and understanding.
   */
  public buildInvestigationPrompt(task: TaskRecord, project: ProjectRecord, model: string): WorkerPayload {
    const lastMessages = task.thread.messages.slice(-5);
    const contextStr = lastMessages
        .map(m => `${m.author}: ${m.body}`)
        .join('\n');

    return {
      model,
      systemPrompt: `You are Ralph, an AI agent investigating a codebase. 
Project Root: ${project.absolutePath}
Objective: ${task.objective.title}
Instructions: Scan the codebase and identify relevant files and architectural patterns.`,
      userPrompt: `Current Objective: ${task.objective.originalPrompt}\n\nRecent History:\n${contextStr}`,
      contextFiles: []
    };
  }

  /**
   * Plans and writes code.
   */
  public buildExecutionPrompt(task: TaskRecord, files: FileContext[], model: string): WorkerPayload {
    const steps = task.context.planning.proposedSteps
        .map(s => `- ${s.description}`)
        .join('\n');

    return {
      model,
      systemPrompt: `You are Ralph, an AI agent implementing a technical plan.
Current Plan:\n${steps}

Output your changes as full file replacements or specific diffs as requested. Avoid conversational filler.`,
      userPrompt: `Target Objective: ${task.objective.title}\nFiles to edit: ${task.context.planning.targetFiles.join(', ')}`,
      contextFiles: files
    };
  }

  /**
   * Fixes errors from verification failures.
   */
  public buildCorrectionPrompt(task: TaskRecord, errorLog: string, model: string): WorkerPayload {
    return {
      model,
      systemPrompt: `The previous implementation failed verification.
Previously attempted code is in the context.
Identify the bug and provide a fixed version.`,
      userPrompt: `Verification Error:\n${errorLog}\n\nTask Objective: ${task.objective.title}`,
      contextFiles: [] 
    };
  }

  /**
   * Evaluates the human intent to redirect the state machine.
   */
  public buildContextAnalysisPrompt(task: TaskRecord, recentComments: string, latestAdminComment: string, model: string): WorkerPayload {
    const systemPrompt = `You are "Ralph", an AI software agent.
Analyze the Admin's latest activity and decide how to respond.

## Current FSM State: ${task.context.currentStep}
## Task: ${task.objective.title}

## Your Investigation Notes
${task.context.investigation.notes || 'No investigation notes available yet.'}

## Instructions
Evaluate the Admin's intent based EXCLUSIVELY on the "LATEST ADMIN COMMENT". Use the conversation history only for context.
1. **QUESTION**: Is the Admin asking a general question? (e.g. "what should be in the readme?") Use your Investigation Notes to formulate the answer.
2. **INSTRUCTION**: Is the Admin giving feedback or new instructions for the code? (e.g. "add a license", "change the logic")
3. **APPROVAL**: Is the Admin giving the "go ahead" or approving a plan?
4. **REJECT**: Is the Admin explicitly rejecting the plan or PR? (e.g. "this is wrong", "close this")
5. **FAST_TRACK**: Is the Admin telling you to skip planning and just write the code? (e.g. "just do it", "skip investigation")
6. **IGNORE**: Is the comment not directed at you or not actionable?

## FINAL OUTPUT FORMAT
You MUST respond strictly with a JSON object matching this exact structure:
{
  "intent": "<one of: QUESTION, INSTRUCTION, APPROVAL, REJECT, FAST_TRACK, IGNORE>",
  "detected_references": ["<string references like #123>"],
  "reasoning": "<string explaining your decision>",
  "suggested_reply": "<string direct answer if intent is QUESTION>"
}`;

    const userPrompt = `## Recent Conversation Context
${recentComments}

## LATEST ADMIN COMMENT (ANALYZE THIS)
"${latestAdminComment}"`;

    return {
      model,
      systemPrompt,
      userPrompt,
      contextFiles: [],
      responseFormat: {
        schema: ContextAnalysisSchema,
        name: "context_analysis"
      }
    };
  }

  /**
   * Phase 4 — Self-review prompt: Ralph reviews the specialist's git diff.
   */
  public buildSelfReviewPrompt(task: TaskRecord, diff: string, model: string): WorkerPayload {
    const systemPrompt = `You are Ralph, an AI senior software engineer performing a self-review of changes made to a codebase.
Your goal is to ensure the changes accurately meet the task objective and follow best practices.

## Task Objective: ${task.objective.title}
## Original Prompt: ${task.objective.originalPrompt}

## Instructions
1. Review the provided git diff carefully.
2. Check for logic errors, missing tests, or security concerns.
3. If the changes are insufficient or incorrect, explain why in the 'notes'.
4. Generate a professional, concise, yet descriptive **Git Commit Message** for these changes.
5. Provide a brief summary of the changes for the 'diff_summary'.

## FINAL OUTPUT FORMAT
You MUST respond strictly with a JSON object matching this exact structure:
{
  "is_satisfactory": <boolean>,
  "notes": "<string detailed feedback>",
  "commit_message": "<string suggested commit message>",
  "diff_summary": "<string paragraph summary of changes>"
}`;

    const userPrompt = `## Git Diff to Review
\`\`\`diff
${diff}
\`\`\``;

    return {
      model,
      systemPrompt,
      userPrompt,
      contextFiles: [],
      responseFormat: {
        schema: SelfReviewSchema,
        name: "self_review"
      }
    };
  }

  /**
   * Evaluates the quality of a finished task.
   */
  public buildJudgePrompt(task: TaskRecord, testsPassed: boolean, fsmSteps: string[], model: string): WorkerPayload {
    const judgePrompt = `You are an expert code reviewer and judge. 
Review the following task execution by an AI agent named Ralph.

TASK: ${task.objective.title}
OBJECTIVE: ${task.objective.originalPrompt}
TESTS PASSED: ${testsPassed ? 'YES' : 'NO'}
FSM PATH: ${fsmSteps.join(' -> ')}

Evaluate the quality, correctness, and adherence to TDD if applicable.

## FINAL OUTPUT FORMAT
You MUST respond strictly with a JSON object matching this exact structure:
{
  "score": <number between 0 and 100>,
  "feedback": "<string explaining your evaluation>",
  "status": "<PASSED or FAILED>"
}`;

    return {
        model,
        systemPrompt: "You are an impartial judge. Respond ONLY with valid JSON.",
        userPrompt: judgePrompt,
        contextFiles: [],
        responseFormat: {
            schema: JudgeScorecardSchema,
            name: "judge_scorecard"
        }
    };
  }
}
