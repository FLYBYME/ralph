import { IAction } from './types.js';

/**
 * ActionRegistry
 * Responsibility: Keeps track of all available high-level workflows.
 */
export class ActionRegistry {
  private actions = new Map<string, IAction>();

  public register(action: IAction): void {
    this.actions.set(action.actionId, action);
  }

  public get(actionId: string): IAction | undefined {
    return this.actions.get(actionId);
  }

  public getAll(): IAction[] {
    return Array.from(this.actions.values());
  }
}
