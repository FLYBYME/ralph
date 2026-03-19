import { ILlmProvider } from './types.js';

/**
 * ProviderRegistry
 * Manages multiple LLM providers and allows selecting the active one.
 */
export class ProviderRegistry {
  private providers: Map<string, { provider: ILlmProvider, config: any }> = new Map();
  private activeProviderId: string | null = null;

  /**
   * Register a new LLM provider with its config.
   */
  public register(provider: ILlmProvider, config: any): void {
    this.providers.set(provider.providerId, { provider, config });
    if (!this.activeProviderId) {
      this.activeProviderId = provider.providerId;
    }
  }

  /**
   * Set the active provider by its ID.
   */
  public setActiveProvider(providerId: string): void {
    if (!this.providers.has(providerId)) {
      throw new Error(`Provider with ID "${providerId}" not found in registry.`);
    }
    this.activeProviderId = providerId;
  }

  /**
   * Get the currently active provider.
   */
  public getActiveProvider(): ILlmProvider {
    if (!this.activeProviderId || !this.providers.has(this.activeProviderId)) {
      throw new Error('No active LLM provider configured.');
    }
    return this.providers.get(this.activeProviderId)!.provider;
  }

  /**
   * Get the model for the currently active provider.
   */
  public getActiveModel(): string {
    if (!this.activeProviderId || !this.providers.has(this.activeProviderId)) {
      throw new Error('No active LLM provider configured.');
    }
    return this.providers.get(this.activeProviderId)!.config.model || 'gpt-4o';
  }

  /**
   * Get a provider by its ID.
   */
  public getProvider(providerId: string): ILlmProvider | undefined {
    return this.providers.get(providerId)?.provider;
  }

  /**
   * Get all registered providers.
   */
  public getAllProviders(): ILlmProvider[] {
    return Array.from(this.providers.values()).map(p => p.provider);
  }
}
