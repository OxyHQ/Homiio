/** A newer action replaced this property's previous local operation. */
export class SavedPropertyChangeSupersededError extends Error {
  constructor() {
    super('This saved property change was superseded');
    this.name = 'SavedPropertyChangeSupersededError';
  }
}
