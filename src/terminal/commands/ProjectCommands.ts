import { CommandDefinition, CommandContext, CommandResult, CommandObject } from './BaseCommand.js';
import { registry } from '../core/registry.js';
import * as path from 'path';
import { ProjectRecord } from '../../infrastructure/storage/types.js';

export const projectAddCommand: CommandDefinition = {
  name: 'project:add',
  description: 'Register a new codebase via API',
  aliases: ['pa', 'add'],
  category: 'project',
  args: [
    { name: 'path', description: 'Path to the codebase', required: false }
  ],
  options: [
    { flags: '-n, --name <name>', description: 'Name of the project' },
    { flags: '-u, --url <url>', description: 'Git clone URL' }
  ],
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    let targetPath = ctx.args['path'];
    const url = ctx.options['url'] as string | undefined;
    const nameOpt = ctx.options['name'] as string | undefined;
    
    if (!targetPath && !url) {
      targetPath = process.cwd();
    } else if (targetPath) {
      targetPath = path.resolve(targetPath);
    }

    let name = nameOpt;
    if (!name) {
       if (url) {
          name = url.split('/').pop()?.replace('.git', '') || 'unknown-project';
       } else if (targetPath) {
          name = path.basename(targetPath);
       } else {
          name = 'unknown-project';
       }
    }

    const project = await ctx.client.addProject({
      name,
      absolutePath: targetPath || '',
      sourceUrl: url
    });

    return {
      success: true,
      message: `Project "${name}" added successfully via API.`,
      json: project as CommandObject
    };
  }
};

export const projectListCommand: CommandDefinition = {
  name: 'project:ls',
  description: 'List registered projects via API',
  aliases: ['pl', 'list'],
  category: 'project',
  execute: async (ctx: CommandContext): Promise<CommandResult> => {
    const projects = await ctx.client.getProjects();
    return {
      success: true,
      title: 'Registered Projects (from API)',
      table: projects.map((p: ProjectRecord) => ({
        ID: p.id.split('-')[0],
        Name: p.name,
        Path: p.absolutePath
      }))
    };
  }
};

registry.register(projectAddCommand);
registry.register(projectListCommand);
