import { CommandDefinition } from '../commands/BaseCommand.js';

class CommandRegistry {
  private commands: Map<string, CommandDefinition> = new Map();

  register(def: CommandDefinition): void {
    this.commands.set(def.name, def);
    for (const alias of def.aliases ?? []) {
      this.commands.set(alias, def);
    }
  }

  get(name: string): CommandDefinition | undefined {
    return this.commands.get(name);
  }

  all(): CommandDefinition[] {
    const seen = new Set<string>();
    const result: CommandDefinition[] = [];
    for (const def of this.commands.values()) {
      if (!seen.has(def.name)) {
        seen.add(def.name);
        result.push(def);
      }
    }
    return result;
  }

  byCategory(): Map<string, CommandDefinition[]> {
    const groups = new Map<string, CommandDefinition[]>();
    for (const def of this.all()) {
      const cat = def.category ?? 'general';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(def);
    }
    return groups;
  }

  forMode(mode: 'cli' | 'repl' | 'tui'): CommandDefinition[] {
    return this.all().filter(d => !d.modes || d.modes.includes(mode));
  }
}

export const registry = new CommandRegistry();
