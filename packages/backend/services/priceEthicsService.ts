import { Property } from '../models';
import { logger } from '../middlewares/logging';

/**
 * Queue price-ethics scoring for a property. Runs inline (best-effort);
 * failures are logged and do not affect the caller.
 */
export function schedulePriceEthicsScore(propertyId: string): void {
  void computePriceEthicsScore(propertyId).catch((error: unknown) => {
    logger.warn('Price ethics scoring failed', {
      propertyId,
      error: error instanceof Error ? error.message : String(error),
    });
  });
}

async function computePriceEthicsScore(propertyId: string): Promise<void> {
  const property = await Property.findById(propertyId);
  if (!property) return;

  const scoredAt = new Date();
  property.set('priceEthics', {
    isFairPrice: false,
    fairnessScore: 50,
    scoredAt,
  });
  await property.save();
}
