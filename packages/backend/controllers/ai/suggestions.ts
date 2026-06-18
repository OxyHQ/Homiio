import type { Request, Response } from 'express';
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

import { logger } from '../../middlewares/logging';
import { Profile, getUserId, ok, err } from './shared';

const DEFAULT_SUGGESTIONS = [
  { text: 'How much should I budget?' },
  { text: 'Review my lease terms' },
  { text: 'What are my rights?' },
  { text: 'Tell me about this area' },
  { text: 'Are there hidden costs?' },
  { text: 'What should I inspect?' },
  { text: 'How to negotiate rent?' },
  { text: 'Red flags to watch for?' },
];

export async function generateSuggestions(req: Request, res: Response) {
  try {
    const userId = getUserId(req);
    if (!userId) return err(res, 401, 'Unauthorized');

    const activeProfile = await Profile.findActiveByOxyUserId(userId);
    if (!activeProfile) return err(res, 404, 'No active profile found');

    const { propertyContext, conversationContext } = (req as any).body || {};

    let contextPrompt = 'Generate 5-6 relevant, actionable chat suggestions for a rental property chat assistant. ';

    if (propertyContext) {
      const { type, city, bedrooms, bathrooms, longTermRent, shortTermRent, amenities } = propertyContext;
      contextPrompt += `Property context: ${type || 'Property'} in ${city || 'the area'}`;
      if (bedrooms) contextPrompt += `, ${bedrooms} bedrooms`;
      if (bathrooms) contextPrompt += `, ${bathrooms} bathrooms`;
      if (longTermRent?.monthlyAmount) {
        contextPrompt += `, ${longTermRent.monthlyAmount} ${longTermRent.currency || ''}/month`;
      } else if (shortTermRent?.nightlyRate) {
        contextPrompt += `, ${shortTermRent.nightlyRate} ${shortTermRent.currency || ''}/night`;
      }
      if (amenities?.length) contextPrompt += `, amenities: ${amenities.slice(0, 3).join(', ')}`;
      contextPrompt += '. ';
    }

    if (conversationContext) {
      contextPrompt += `Recent conversation topics: ${conversationContext.slice(0, 200)}. `;
    }

    contextPrompt += `
Return suggestions as a JSON array of objects with only "text" field. 
Focus on practical questions tenants ask about properties: budget, legal rights, neighborhood, lease terms, inspections, negotiations, and area information.
Make suggestions conversational and specific. Examples:
{"text": "How much should I budget monthly?"}
{"text": "What should I inspect before signing?"}
{"text": "Tell me about this neighborhood"}
{"text": "Review these lease terms"}

Return only the JSON array, no other text.`;

    const result = await streamText({
      model: openai('gpt-4o'),
      temperature: 0.7,
      system: 'You are a helpful AI that generates relevant chat suggestions for rental property conversations. Return valid JSON only.',
      messages: [{ role: 'user', content: contextPrompt }],
      maxTokens: 500,
    } as any);

    let generatedText = '';
    for await (const chunk of result.textStream) {
      generatedText += chunk;
    }

    let suggestions: Array<{ text: string }>;
    try {
      const cleaned = generatedText.trim().replace(/```json|```/g, '');
      const parsed = JSON.parse(cleaned);

      if (!Array.isArray(parsed)) {
        throw new Error('Response is not an array');
      }

      suggestions = parsed
        .filter((s: any) => s && s.text && typeof s.text === 'string')
        .slice(0, 8);
    } catch (parseError) {
      logger.warn('Failed to parse AI suggestions, using default', {
        error: (parseError as Error)?.message,
      });
      suggestions = DEFAULT_SUGGESTIONS;
    }

    return ok(res, {
      success: true,
      suggestions,
      generated: suggestions.length > 0,
      propertyContext: !!propertyContext,
    });
  } catch (error: any) {
    logger.error('generateSuggestions failed', { error: error?.message });
    return err(res, 500, 'Failed to generate suggestions');
  }
}
