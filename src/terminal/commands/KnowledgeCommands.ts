import { registry } from '../core/registry.js';
import { CommandContext } from './BaseCommand.js';
import chalk from 'chalk';

registry.register({
  name: 'kb:search',
  description: 'Search the internal knowledge base.',
  args: [{ name: 'query', description: 'Keyword or semantic query', required: true }],
  options: [{ flags: '--category <category>', description: 'Filter by category: Runbook, Architecture, Policy, Tutorial' }],
  execute: async (ctx: CommandContext) => {
    const results = await ctx.client.searchKnowledge(ctx.args.query!, ctx.options.category as string);
    if (results.length === 0) return { success: true, message: 'No knowledge entries found.' };
    
    console.log(chalk.bold(`\nKnowledge Base Search Results for "${ctx.args.query}":`));
    for (const e of results) {
      console.log(`${chalk.green.bold(e.id)} - ${chalk.white.bold(e.title)} (${chalk.yellow(e.category)})`);
      console.log(chalk.dim(`  Tags: ${e.tags.join(', ')}`));
    }
    return { success: true };
  }
});

registry.register({
  name: 'kb:read',
  description: 'Read a full knowledge base entry.',
  args: [{ name: 'id', description: 'Entry ID (e.g. kb-arch-1234)', required: true }],
  execute: async (ctx: CommandContext) => {
    const entry = await ctx.client.getKnowledgeEntry(ctx.args.id!);
    if (!entry) return { success: false, message: 'Knowledge entry not found.' };

    console.log(`\n${chalk.blue.bold('TITLE:')} ${chalk.bold(entry.title)}`);
    console.log(`${chalk.blue.bold('ID:')} ${entry.id}`);
    console.log(`${chalk.blue.bold('CATEGORY:')} ${entry.category}`);
    console.log(`${chalk.blue.bold('LAST UPDATED:')} ${entry.lastUpdated}`);
    console.log(`${chalk.blue.bold('TAGS:')} ${entry.tags.join(', ')}`);
    console.log(chalk.dim('─'.repeat(40)));
    
    for (const block of entry.contentBlocks) {
      console.log(`\n${block}`);
    }

    if (entry.relatedEntries.length > 0) {
      console.log(`\n${chalk.blue.bold('RELATED:')} ${entry.relatedEntries.join(', ')}`);
    }

    return { success: true };
  }
});

registry.register({
  name: 'kb:publish',
  description: 'Publish a new entry to the knowledge base.',
  args: [
    { name: 'title', description: 'Entry title', required: true },
    { name: 'category', description: 'Runbook, Architecture, Policy, Tutorial', required: true },
    { name: 'content', description: 'Body text (use double newlines for blocks)', required: true }
  ],
  options: [{ flags: '--tags <tags>', description: 'Comma separated tags' }],
  execute: async (ctx: CommandContext) => {
    const content = ctx.args.content || '';
    const entry = await ctx.client.publishKnowledge({
      title: ctx.args.title!,
      category: ctx.args.category!,
      tags: ctx.options.tags ? (ctx.options.tags as string).split(',') : [],
      contentBlocks: content.split('\n\n').map((b: string) => b.trim()).filter(Boolean),
      relatedEntries: []
    });
    return { success: true, message: `Knowledge entry published: ${entry.id}` };
  }
});

registry.register({
  name: 'kb:request',
  description: 'Ask Ralph to research a topic and publish a KB entry.',
  args: [
    { name: 'projectId', description: 'Target project', required: true },
    { name: 'objective', description: 'What to research and document', required: true }
  ],
  execute: async (ctx: CommandContext) => {
    const prompt = `Research and document the following: ${ctx.args.objective}. 
    When finished, use the 'publishKnowledge' tool to save your findings to the knowledge base.`;
    
    const task = await ctx.client.createTask('solve', ctx.args.projectId!, prompt, false, ['knowledge-request']);
    return { success: true, message: `Research task created: ${task.taskId}` };
  }
});
