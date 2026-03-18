import { EventType, SystemEvent, EventHandler } from './types.js';

/**
 * LocalEventBus
 * Responsibility: The central nervous system.
 * Decouples logic from logging and UI via strongly-typed events.
 */
export class LocalEventBus {
  private listeners: Map<EventType, Set<EventHandler>> = new Map();
  private backlog: SystemEvent[] = [];
  private maxBacklog = 200;

  /**
   * Registers a listener for a specific event type.
   */
  public subscribe(eventType: EventType, handler: EventHandler): void {
    if (!this.listeners.has(eventType)) {
      this.listeners.set(eventType, new Set());
    }
    this.listeners.get(eventType)?.add(handler);
  }

  /**
   * Synchronously routes an event to all registered local listeners.
   */
  public publish(event: SystemEvent): void {
    // Maintain backlog
    this.backlog.push(event);
    if (this.backlog.length > this.maxBacklog) {
      this.backlog.shift();
    }

    const handlers = this.listeners.get(event.type);
    if (!handlers) return;

    for (const handler of handlers) {
      try {
        handler(event);
      } catch (error) {
        // We catch errors to ensure one failing listener doesn't crash the bus/orchestrator
        console.error(`[LocalEventBus] Error in subscriber for ${event.type}:`, error);
      }
    }
  }

  /**
   * Helper to unsubscribe (optional but good practice)
   */
  public unsubscribe(eventType: EventType, handler: EventHandler): void {
    const handlers = this.listeners.get(eventType);
    if (handlers) {
      handlers.delete(handler);
    }
  }

  /**
   * Retrieves historical events filtering by taskId or type.
   */
  public getBacklog(taskId?: string, filterTypes?: EventType[]): SystemEvent[] {
    let result = this.backlog;
    if (taskId) {
      result = result.filter(e => e.taskId === taskId);
    }
    if (filterTypes && filterTypes.length > 0) {
      result = result.filter(e => filterTypes.includes(e.type));
    }
    return result;
  }

  /**
   * Updates the maximum backlog size and prunes if necessary.
   */
  public setMaxBacklog(size: number): void {
    if (size < 0) return;
    this.maxBacklog = size;
    while (this.backlog.length > this.maxBacklog) {
      this.backlog.shift();
    }
  }
}
