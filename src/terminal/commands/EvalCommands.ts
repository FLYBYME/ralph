import { registry } from '../core/registry.js';
import { CommandContext } from './BaseCommand.js';
import chalk from 'chalk';

registry.register({
  name: 'eval:run',
  description: 'Trigger an evaluation scenario to test Ralph performance.',
  args: [{ name: 'scenarioId', description: 'Scenario ID (e.g. tdd-auth-bypass)', required: true }],
  execute: async (ctx: CommandContext) => {
    const result = await ctx.client.runEval(ctx.args.scenarioId!);
    console.log(chalk.green(`\n🚀 Evaluation started! Eval ID: ${chalk.bold(result.evalId)}`));
    console.log(chalk.dim(`Use "eval:status ${result.evalId}" to check progress.`));
    return { success: true };
  }
});

registry.register({
  name: 'eval:status',
  description: 'Check the status and scorecard of a running evaluation.',
  args: [{ name: 'evalId', description: 'The evaluation ID', required: true }],
  execute: async (ctx: CommandContext) => {
    const status = await ctx.client.getEvalStatus(ctx.args.evalId!);
    
    console.log(`\n${chalk.blue.bold('EVALUATION STATUS')}`);
    console.log(`${chalk.dim('ID:')} ${status.id}`);
    console.log(`${chalk.dim('Scenario:')} ${status.scenarioId}`);
    console.log(`${chalk.dim('Status:')} ${status.status === 'PASSED' ? chalk.green(status.status) : status.status === 'FAILED' ? chalk.red(status.status) : chalk.yellow(status.status)}`);
    console.log(`${chalk.dim('Start Time:')} ${status.startTime}`);
    
    if (status.endTime) {
        console.log(`${chalk.dim('End Time:')} ${status.endTime}`);
        console.log(`${chalk.dim('Score:')} ${status.score}/100`);
        console.log(`\n${chalk.bold('Judge Feedback:')}\n${status.feedback}`);
    } else {
        console.log(`\n${chalk.yellow('Evaluation still in progress...')}`);
        console.log(`${chalk.dim('Current Path:')} ${status.fsmSteps.join(' -> ')}`);
    }
    
    return { success: true };
  }
});

registry.register({
  name: 'eval:ls',
  description: 'List historical evaluation results.',
  execute: async (ctx: CommandContext) => {
    const results = await ctx.client.getEvalResults();
    if (results.length === 0) return { success: true, message: 'No evaluation history found.' };

    console.log(chalk.bold('\nEvaluation History:'));
    for (const r of results) {
        const statusColor = r.status === 'PASSED' ? chalk.green : r.status === 'FAILED' ? chalk.red : chalk.yellow;
        console.log(`${chalk.dim(r.startTime.split('T')[0])} | ${chalk.yellow(r.id.slice(0,8))} | ${r.scenarioId.padEnd(20)} | ${statusColor(r.status.padEnd(8))} | Score: ${r.score ?? '--'}`);
    }
    return { success: true };
  }
});

registry.register({
  name: 'eval:scenarios',
  description: 'List available evaluation scenarios.',
  execute: async (ctx: CommandContext) => {
    const scenarios = await ctx.client.getEvalScenarios();
    console.log(chalk.bold('\nAvailable Evaluation Scenarios:'));
    for (const s of scenarios) {
        console.log(`${chalk.green.bold(s.id)}: ${s.title}`);
        console.log(chalk.dim(`  ${s.description}`));
    }
    return { success: true };
  }
});
