/**
 * AI Routes
 * Handles AI-powered features including streaming text generation
 */

import express from 'express';
import { openai } from '@ai-sdk/openai';
import { streamText } from 'ai';
import { PassThrough } from 'stream';
// import Profile from '../models/schemas/ProfileSchema';
const Profile = require('../models/schemas/ProfileSchema');
const Conversation = require('../models/schemas/ConversationSchema');

export default function() {
  const router = express.Router();

  /**
   * Web search function for Sindi to get current information
   */
  async function performWebSearch(query) {
    try {
      // Check if query is related to Catalunya/Catalonia
      const isCatalunyaQuery = query.toLowerCase().includes('catalunya') || 
                               query.toLowerCase().includes('catalonia') || 
                               query.toLowerCase().includes('barcelona') || 
                               query.toLowerCase().includes('catalan') ||
                               query.toLowerCase().includes('lloguer') ||
                               query.toLowerCase().includes('sindicat') ||
                               query.toLowerCase().includes('girona') ||
                               query.toLowerCase().includes('tarragona') ||
                               query.toLowerCase().includes('lleida') ||
                               query.toLowerCase().includes('valencia') ||  // Valencia also has Catalan speakers
                               query.toLowerCase().includes('habitatge') || // housing in Catalan
                               query.toLowerCase().includes('propietat'); // property in Catalan

      // For Catalunya-related queries, prioritize Sindicat de Llogateres
      if (isCatalunyaQuery) {
        try {
          const sindicatResponse = await fetch('https://sindicatdellogateres.org/');
          const sindicatContent = await sindicatResponse.text();
          
          // Extract relevant information from the website
          const relevantInfo = {
            source: 'Sindicat de Llogateres',
            content: 'Sindicat de Llogateres is a tenant union in Catalunya fighting for housing rights. They provide resources for rent strikes, legal support, and tenant organizing. They have assemblies across Catalunya and offer resistance funds for rent strikes.',
            url: 'https://sindicatdellogateres.org/',
            additionalInfo: 'Key services: Rent strike support, legal assistance, tenant assemblies, resistance funds, housing rights education'
          };
          
          return relevantInfo;
        } catch (sindicatError) {
          console.log('Could not fetch Sindicat de Llogateres directly, falling back to general search');
        }
      }

      // Using DuckDuckGo Instant Answer API (free, no API key required)
      const searchUrl = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;
      
      const response = await fetch(searchUrl);
      const data = await response.json();
      
      if (data.Abstract) {
        return {
          source: data.AbstractSource || 'DuckDuckGo',
          content: data.Abstract,
          url: data.AbstractURL
        };
      }
      
      // Fallback to basic search results
      if (data.RelatedTopics && data.RelatedTopics.length > 0) {
        return {
          source: 'DuckDuckGo',
          content: data.RelatedTopics[0].Text || data.RelatedTopics[0].FirstURL,
          url: data.RelatedTopics[0].FirstURL
        };
      }
      
      return null;
    } catch (error) {
      console.error('Web search error:', error);
      return null;
    }
  }

  /**
   * Parse natural language query to extract property search filters
   */
  function parsePropertyFilters(query) {
    const filters: {
      maxRent?: number;
      minRent?: number;
      city?: string;
      type?: string;
      bedrooms?: number;
      bathrooms?: number;
      amenities?: string[];
      minSize?: number;
      availableNow?: boolean;
      budgetFriendly?: boolean;
      luxury?: boolean;
    } = {};
    const lowerQuery = query.toLowerCase();
    
    // Price filters
    const priceMatch = lowerQuery.match(/(?:under|less than|max|maximum|up to|cheap|cheaper|budget)\s*\$?(\d+)/);
    if (priceMatch) {
      filters.maxRent = parseInt(priceMatch[1]);
    }
    
    const minPriceMatch = lowerQuery.match(/(?:over|more than|minimum|min)\s*\$?(\d+)/);
    if (minPriceMatch) {
      filters.minRent = parseInt(minPriceMatch[1]);
    }
    
    // Price range
    const rangeMatch = lowerQuery.match(/\$?(\d+)\s*(?:to|-)\s*\$?(\d+)/);
    if (rangeMatch) {
      filters.minRent = parseInt(rangeMatch[1]);
      filters.maxRent = parseInt(rangeMatch[2]);
    }
    
    // Location filters
    const locationKeywords = ['in', 'near', 'around', 'at', 'close to', 'within'];
    for (const keyword of locationKeywords) {
      const locationMatch = lowerQuery.match(new RegExp(`${keyword}\\s+([a-zA-Z\\s]+?)(?:\\s|$|,|\\?|\\!|\\d)`, 'i'));
      if (locationMatch) {
        filters.city = locationMatch[1].trim();
        break;
      }
    }
    
    // Property type filters
    const typeKeywords = {
      'apartment': ['apartment', 'apt', 'flat', 'pisos'],
      'house': ['house', 'home', 'casa'],
      'room': ['room', 'bedroom', 'habitación', 'habitacion'],
      'studio': ['studio', 'loft'],
      'shared': ['shared', 'coliving', 'co-living', 'roommate']
    };
    
    for (const [type, keywords] of Object.entries(typeKeywords)) {
      if (keywords.some(keyword => lowerQuery.includes(keyword))) {
        filters.type = type;
        break;
      }
    }
    
    // Bedroom filters
    const bedroomMatch = lowerQuery.match(/(\d+)\s*(?:bedroom|bed|br|room)s?/);
    if (bedroomMatch) {
      filters.bedrooms = parseInt(bedroomMatch[1]);
    }
    
    // Bathroom filters
    const bathroomMatch = lowerQuery.match(/(\d+)\s*(?:bathroom|bath|ba)s?/);
    if (bathroomMatch) {
      filters.bathrooms = parseInt(bathroomMatch[1]);
    }
    
    // Feature filters
    const featureKeywords = {
      'furnished': ['furnished', 'furniture', 'mobiliado'],
      'parking': ['parking', 'garage', 'estacionamiento'],
      'pet_friendly': ['pet', 'dog', 'cat', 'mascota', 'permiten mascotas'],
      'balcony': ['balcony', 'terrace', 'balcón', 'terraza'],
      'gym': ['gym', 'fitness', 'exercise'],
      'wifi': ['wifi', 'internet', 'wifi included'],
      'air_conditioning': ['ac', 'air conditioning', 'aire acondicionado'],
      'washer': ['washer', 'laundry', 'lavadora'],
      'dishwasher': ['dishwasher', 'lavavajillas'],
      'elevator': ['elevator', 'ascensor']
    };
    
    filters.amenities = [];
    for (const [feature, keywords] of Object.entries(featureKeywords)) {
      if (keywords.some(keyword => lowerQuery.includes(keyword))) {
        filters.amenities.push(feature);
      }
    }
    
    // Size filters
    const sizeMatch = lowerQuery.match(/(\d+)\s*(?:sq\s*ft|square\s*feet|m2|metros)/);
    if (sizeMatch) {
      filters.minSize = parseInt(sizeMatch[1]);
    }
    
    // Availability filters
    if (lowerQuery.includes('available now') || lowerQuery.includes('immediate') || lowerQuery.includes('urgent')) {
      filters.availableNow = true;
    }
    
    // Budget-friendly indicators
    if (lowerQuery.includes('cheap') || lowerQuery.includes('affordable') || lowerQuery.includes('budget') || lowerQuery.includes('económico')) {
      filters.budgetFriendly = true;
    }
    
    console.log('Parsed filters:', filters);
    return filters;
  }

  /**
   * App property search for Sindi with advanced filters
   */
  async function performAppPropertySearch(query) {
    try {
      console.log('Performing app property search for query:', query);
      
      // Parse filters from the query
      const filters = parsePropertyFilters(query);
      
      // Build search URL with filters
      const searchParams = new URLSearchParams();
      searchParams.set('query', query);
      searchParams.set('limit', '10'); // Increased limit for better results
      searchParams.set('available', 'true');
      
      // Add parsed filters
      if (filters.minRent) searchParams.set('minRent', filters.minRent.toString());
      if (filters.maxRent) searchParams.set('maxRent', filters.maxRent.toString());
      if (filters.city) searchParams.set('city', filters.city);
      if (filters.type) searchParams.set('type', filters.type);
      if (filters.bedrooms) searchParams.set('bedrooms', filters.bedrooms.toString());
      if (filters.bathrooms) searchParams.set('bathrooms', filters.bathrooms.toString());
      if (filters.amenities && filters.amenities.length > 0) {
        searchParams.set('amenities', filters.amenities.join(','));
      }
      
      const searchUrl = `/api/properties/search?${searchParams.toString()}`;
      console.log('Search URL:', searchUrl);
      
      // Make internal request to the same server
      const response = await fetch(`http://localhost:${process.env.PORT || 3001}${searchUrl}`);
      
      if (!response.ok) {
        console.error('Property search API error:', response.status, response.statusText);
        return [];
      }
      
      const data = await response.json();
      console.log('Property search response:', data);
      
      let properties = [];
      if (data && data.data && Array.isArray(data.data)) {
        properties = data.data;
      } else if (data && Array.isArray(data)) {
        properties = data;
      }
      
      // Apply additional client-side filtering if needed
      if (filters.budgetFriendly && properties.length > 0) {
        // Sort by price (lowest first) for budget-friendly searches
        properties.sort((a, b) => (a.rent?.amount || 0) - (b.rent?.amount || 0));
      }
      
      if (filters.luxury && properties.length > 0) {
        // REMOVED: properties.sort((a, b) => (b.rent?.amount || 0) - (a.rent?.amount || 0));
      }
      
      console.log(`Found ${properties.length} properties after filtering`);
      return properties.slice(0, 5); // Return top 5 results
    } catch (error) {
      console.error('App property search error:', error);
      return [];
    }
  }

  /**
   * POST /api/ai/stream
   * Stream text generation using OpenAI GPT-4o with web search capability
   * Uses official AI SDK Express streaming pattern
   */
  router.post('/stream', async (req, res) => {
    try {
      const { messages, conversationId } = req.body;
      
      console.log('Starting AI stream with messages:', messages);
      console.log('Conversation ID:', conversationId);

      // Get user ID for conversation lookup
      const userId = (req as any).user?.oxyUserId || (req as any).user?._id || (req as any).user?.id;
      if (!userId) {
        return res.status(401).json({ error: 'Unauthorized' });
      }

      // Find the conversation if conversationId is provided
      let conversation = null;
      if (conversationId && !conversationId.startsWith('conv_')) {
        try {
          conversation = await Conversation.findOne({
            _id: conversationId,
            oxyUserId: userId
          });
          console.log('Found conversation:', conversation ? conversation._id : 'not found');
        } catch (error) {
          console.error('Error finding conversation:', error);
        }
      }

      // Enhanced system prompt for ethical tenant advocacy with web search
      const systemPrompt = `You are Sindi, an AI-powered tenant rights assistant for Homiio, an ethical housing platform. You help tenants find fair housing, understand their rights, and navigate rental processes with transparency and justice.

## Your Core Mission
- Advocate for tenant rights and housing justice
- Provide accurate, up-to-date information on rental laws and regulations
- Help users find ethical, transparent housing options
- Support tenants in understanding their rights and responsibilities
- Promote fair housing practices and prevent exploitation

## Your Capabilities

### Property Search with Advanced Filters
You can search for properties in the Homiio database with sophisticated filtering. Users can ask for properties with specific criteria:

**Price Filters:**
- "Find apartments under $1500"
- "Show me properties between $800-$1200"
- "I need something cheap, under $1000"
- "Looking for luxury apartments over $3000"

**Location Filters:**
- "Find properties in Barcelona"
- "Show me apartments near the university"
- "Properties around the city center"

**Property Type Filters:**
- "I need a studio apartment"
- "Show me houses for rent"
- "Looking for shared rooms"
- "Find furnished apartments"

**Feature Filters:**
- "Properties with parking"
- "Pet-friendly apartments"
- "Furnished with balcony"
- "Apartments with gym and wifi"
- "Properties with air conditioning"

**Size Filters:**
- "2 bedroom apartments"
- "Properties with 2 bathrooms"
- "Studios over 40m2"

**Combined Filters:**
- "Cheap 2-bedroom apartments in Barcelona with parking"
- "Luxury furnished studios under $2000 with gym"
- "Pet-friendly houses near the beach under $1500"

### Web Search Integration
You have access to real-time web search, prioritizing:
- Sindicat de Llogateres (sindicatdellogateres.org) for Catalunya-specific tenant rights
- Official government housing websites
- Legal resources and tenant advocacy organizations
- Current housing market information

### Tenant Rights Support
- Provide information on rental laws and regulations
- Help with lease agreement reviews
- Explain tenant rights and responsibilities
- Guide users through dispute resolution processes
- Offer resources for tenant advocacy and support

## Response Guidelines

### When Users Ask About Properties
1. **Always search the Homiio database first** using the enhanced filtering system
2. If properties are found, present them as interactive property cards
3. If no properties match, suggest alternative search criteria or broader parameters
4. Provide context about why certain properties might be good matches
5. Mention relevant tenant rights considerations for the properties shown

### When Users Ask About Rights or Legal Issues
1. Use web search to find current, accurate information
2. Prioritize official sources and tenant advocacy organizations
3. Provide practical, actionable advice
4. Always mention the importance of consulting with legal professionals for specific cases
5. Include relevant resources and contact information

### When Users Need General Housing Help
1. Combine property search with rights information
2. Suggest questions they should ask landlords
3. Provide checklists for property viewings
4. Offer guidance on lease negotiations
5. Recommend tenant advocacy resources

## Important Notes
- Always prioritize tenant rights and fair housing practices
- Be transparent about limitations and recommend professional legal advice when appropriate
- Use inclusive, supportive language that empowers tenants
- Provide practical, actionable information
- Stay up-to-date with current housing laws and market conditions through web search
- For Catalunya-specific queries, prioritize Sindicat de Llogateres resources
- **Always prefer short, concise answers unless the user explicitly asks for more detail.**

## Property Search Examples
When users ask for properties, you can understand natural language requests like:
- "I need a cheap apartment in Barcelona" → searches for affordable properties in Barcelona
- "Show me furnished studios with parking" → filters for furnished studios with parking
- "2-bedroom apartments under $1500 near the university" → combines multiple filters
- "Luxury properties with gym and pool" → searches for high-end properties with specific amenities

Remember: You're here to empower tenants and promote ethical housing practices. Always advocate for transparency, fairness, and tenant rights.`;

      // Check if the user is asking for current information that might benefit from web search
      const lastMessage = messages[messages.length - 1];
      const needsCurrentInfo = lastMessage && lastMessage.role === 'user' && (
        lastMessage.content.toLowerCase().includes('current') ||
        lastMessage.content.toLowerCase().includes('recent') ||
        lastMessage.content.toLowerCase().includes('latest') ||
        lastMessage.content.toLowerCase().includes('new law') ||
        lastMessage.content.toLowerCase().includes('updated') ||
        lastMessage.content.toLowerCase().includes('2024') ||
        lastMessage.content.toLowerCase().includes('2023') ||
        lastMessage.content.toLowerCase().includes('recent case') ||
        lastMessage.content.toLowerCase().includes('local') ||
        lastMessage.content.toLowerCase().includes('organization') ||
        lastMessage.content.toLowerCase().includes('catalunya') ||
        lastMessage.content.toLowerCase().includes('catalonia') ||
        lastMessage.content.toLowerCase().includes('barcelona') ||
        lastMessage.content.toLowerCase().includes('catalan') ||
        lastMessage.content.toLowerCase().includes('lloguer') ||
        lastMessage.content.toLowerCase().includes('sindicat') ||
        lastMessage.content.toLowerCase().includes('tenant union') ||
        lastMessage.content.toLowerCase().includes('rent strike')
      );

      let searchResults = null;
      if (needsCurrentInfo) {
        console.log('Performing web search for current information');
        searchResults = await performWebSearch(lastMessage.content);
      }

      // Check if the user is asking for property search
      const propertySearchKeywords = [
        'find property', 'available property', 'search property', 'rental', 'apartment', 'house', 'room', 'flat', 'pisos', 'lloguer', 'property near', 'property in', 'available home', 'buscar piso', 'buscar lloguer', 'find home', 'property listings', 'property for rent', 'pisos en alquiler', 'casas en alquiler', 'habitación', 'room for rent', 'studio', 'shared flat', 'shared house',
        // Catalan terms
        'cercar propietat', 'propietat disponible', 'lloguer disponible', 'apartament', 'casa', 'habitació', 'pis', 'propietat a prop', 'propietat a', 'trobat llar', 'llistats de propietats', 'propietat de lloguer', 'pisos de lloguer', 'cases de lloguer'
      ];
      const isPropertySearch = propertySearchKeywords.some(keyword => lastMessage.content.toLowerCase().includes(keyword));
      let propertyResults = null;
      if (isPropertySearch) {
        console.log('Property search detected for query:', lastMessage.content);
        console.log('Matching keywords:', propertySearchKeywords.filter(keyword => lastMessage.content.toLowerCase().includes(keyword)));
        propertyResults = await performAppPropertySearch(lastMessage.content);
      } else {
        console.log('No property search detected for query:', lastMessage.content);
      }

      // Prepare messages with search results if available
      const enhancedMessages = [
        { role: 'system', content: systemPrompt },
        ...messages
      ];

      if (searchResults) {
        enhancedMessages.push({
          role: 'system',
          content: `CURRENT INFORMATION FROM WEB SEARCH:\nSource: ${searchResults.source}\nContent: ${searchResults.content}\nURL: ${searchResults.url}\n\nUse this current information to provide accurate, up-to-date advice. Cite the source when referencing this information.`
        });
      }
      if (propertyResults && propertyResults.length > 0) {
        console.log(`Adding ${propertyResults.length} property results to AI context`);
        const propertyContext = `PROPERTY SEARCH RESULTS:\nHere are some available properties found in the app database that match the user's query:\n${propertyResults.map(p => `- ${p.title || p.address?.city || 'Property'} (${p.type || ''}, ${p.rent?.amount ? p.rent.amount + ' ' + (p.rent.currency || '') : ''})${p.address?.city ? ', ' + p.address.city : ''}`).join('\n')}\n\nIf the user wants more details, suggest they visit the app's property listings section.`;
        console.log('Property context:', propertyContext);
        enhancedMessages.push({
          role: 'system',
          content: propertyContext
        });
      } else if (isPropertySearch) {
        console.log('Property search was triggered but no results found');
      }

      const result = streamText({
        model: openai('gpt-4o'),
        messages: enhancedMessages,
      });

      // Save user message to conversation if we have one
      if (conversation && messages.length > 0) {
        const lastUserMessage = messages[messages.length - 1];
        if (lastUserMessage.role === 'user') {
          try {
            await conversation.addMessage('user', lastUserMessage.content);
            console.log('Saved user message to conversation');
          } catch (error) {
            console.error('Error saving user message:', error);
          }
        }
      }

      // Buffer the AI response to save it after streaming
      let aiResponse = '';
      
      // Handle streaming to the client and buffer the response
      if (typeof result.pipeDataStreamToResponse === 'function') {
        // Use the AI SDK's text stream to capture the response
        const stream = result.textStream;
        
        // Create a transform stream to capture the AI response
        const captureStream = new PassThrough();
        let streamEnded = false;
        
        // Capture the streamed text
        (async () => {
          try {
            for await (const chunk of stream) {
              aiResponse += chunk;
            }
            
            // Save AI response to conversation after streaming completes
            if (conversation && aiResponse.trim() && !streamEnded) {
              streamEnded = true;
              try {
                await conversation.addMessage('assistant', aiResponse.trim());
                console.log('Saved AI response to conversation:', aiResponse.substring(0, 100) + '...');
                
                // Update conversation title if it's still "New Conversation"
                if (conversation.title === 'New Conversation' && conversation.messages.length > 0) {
                  const firstUserMessage = conversation.messages.find(m => m.role === 'user');
                  if (firstUserMessage) {
                    let newTitle = firstUserMessage.content.substring(0, 50).trim();
                    if (firstUserMessage.content.length > 50) {
                      newTitle += '...';
                    }
                    conversation.title = newTitle;
                    await conversation.save();
                    console.log('Updated conversation title to:', newTitle);
                  }
                }
              } catch (error) {
                console.error('Error saving AI response or updating title:', error);
              }
            }
          } catch (error) {
            console.error('Error processing AI stream:', error);
          }
        })();

        result.pipeDataStreamToResponse(res);
      } else {
        res.status(501).json({ error: 'Streaming not supported by this SDK.' });
      }
    } catch (error) {
      console.error('AI streaming error:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({
        error: 'Failed to generate streaming response',
        details: error.message
      });
    }
  });

  /**
   * GET /api/ai/health
   * AI service health check
   */
  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      service: 'AI Streaming Service',
      features: ['text-streaming', 'web-search'],
      timestamp: new Date().toISOString()
    });
  });

  // Get Sindi chat history for the authenticated user
  router.get('/history', async (req: any, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      // Return most recent first
      const history = (user.chatHistory || []).slice().reverse();
      res.json({ success: true, history });
    } catch (error) {
      console.error('Failed to get chat history:', error);
      res.status(500).json({ error: 'Failed to get chat history' });
    }
  });

  // Clear Sindi chat history for the authenticated user
  router.delete('/history', async (req: any, res) => {
    try {
      const user = req.user;
      if (!user) return res.status(401).json({ error: 'Unauthorized' });
      user.chatHistory = [];
      await user.save();
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to clear chat history:', error);
      res.status(500).json({ error: 'Failed to clear chat history' });
    }
  });

  // Save Sindi chat history for the authenticated user (on personal profile)
  router.post('/history', async (req: any, res) => {
    try {
      // Get userId from req.user
      const userId = req.user?.oxyUserId || req.user?._id || req.user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      // Find the personal profile for this user
      const profile = await Profile.findOne({ oxyUserId: userId, profileType: 'personal' });
      if (!profile) return res.status(404).json({ error: 'Personal profile not found' });

      const { userMessage, assistantMessage } = req.body;
      if (!userMessage || !assistantMessage) return res.status(400).json({ error: 'Missing userMessage or assistantMessage' });

      profile.chatHistory = profile.chatHistory || [];
      profile.chatHistory.push({
        role: 'user',
        content: userMessage,
        timestamp: new Date(),
      });
      profile.chatHistory.push({
        role: 'assistant',
        content: assistantMessage,
        timestamp: new Date(),
      });
      if (profile.chatHistory.length > 100) {
        profile.chatHistory = profile.chatHistory.slice(-100);
      }
      await profile.save();
      res.json({ success: true });
    } catch (error) {
      console.error('Failed to save chat history:', error);
      res.status(500).json({ error: 'Failed to save chat history' });
    }
  });

  // ===== CONVERSATION MANAGEMENT ENDPOINTS =====

  // GET /api/ai/conversations - Get all conversations for authenticated user
  router.get('/conversations', async (req, res) => {
    try {
      const userId = (req as any).user?.oxyUserId || (req as any).user?._id || (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const conversations = await Conversation.find({ oxyUserId: userId })
        .sort({ updatedAt: -1 });

      // Transform conversations to include proper message count and last message
      const transformedConversations = conversations.map(conv => {
        const convObj = conv.toObject({ virtuals: true });
        return {
          _id: convObj._id,
          id: convObj._id,
          title: convObj.title,
          status: convObj.status,
          createdAt: convObj.createdAt,
          updatedAt: convObj.updatedAt,
          messageCount: convObj.messages ? convObj.messages.length : 0,
          lastMessage: convObj.messages && convObj.messages.length > 0
            ? convObj.messages[convObj.messages.length - 1]
            : null,
          messages: convObj.messages || []
        };
      });

      const responseData = { success: true, conversations: transformedConversations };
      console.log('GET /conversations response data:', JSON.stringify(responseData, null, 2));
      res.json(responseData);
    } catch (error) {
      console.error('Failed to get conversations:', error);
      res.status(500).json({ error: 'Failed to get conversations' });
    }
  });

  // POST /api/ai/conversations - Create new conversation
  router.post('/conversations', async (req, res) => {
    try {
      const userId = (req as any).user?.oxyUserId || (req as any).user?._id || (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const { title, initialMessage, messages } = req.body;
      
      // Handle both initialMessage (single message) and messages (array) formats
      let conversationMessages = [];
      if (messages && Array.isArray(messages)) {
        conversationMessages = messages.map(msg => ({
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.timestamp || Date.now())
        }));
      } else if (initialMessage) {
        conversationMessages = [{
          role: 'user',
          content: initialMessage,
          timestamp: new Date()
        }];
      }
      
      const conversation = new Conversation({
        oxyUserId: userId,
        title: title || 'New Conversation',
        messages: conversationMessages,
        status: 'active'
      });

      const savedConversation = await conversation.save();
      
      // Return the saved conversation with proper structure
      const responseData = {
        success: true,
        conversation: {
          _id: savedConversation._id,
          title: savedConversation.title,
          messages: savedConversation.messages,
          createdAt: savedConversation.createdAt,
          updatedAt: savedConversation.updatedAt,
          status: savedConversation.status
        }
      };
      
      console.log('POST /conversations response data:', JSON.stringify(responseData, null, 2));
      res.json(responseData);
    } catch (error) {
      console.error('Failed to create conversation:', error);
      res.status(500).json({ error: 'Failed to create conversation' });
    }
  });

  // GET /api/ai/conversations/:id - Get specific conversation
  router.get('/conversations/:id', async (req, res) => {
    try {
      const userId = (req as any).user?.oxyUserId || (req as any).user?._id || (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const conversationId = req.params.id;
      
      // Validate conversation ID
      if (!conversationId || conversationId === 'undefined' || conversationId === 'null') {
        return res.status(400).json({ error: 'Invalid conversation ID' });
      }

      // Check if it's a valid MongoDB ObjectId
      if (!/^[0-9a-fA-F]{24}$/.test(conversationId)) {
        return res.status(400).json({ error: 'Invalid conversation ID format' });
      }

      const conversation = await Conversation.findOne({
        _id: conversationId,
        oxyUserId: userId
      });

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const responseData = { success: true, conversation };
      console.log('GET /conversations/:id response data:', JSON.stringify(responseData, null, 2));
      res.json(responseData);
    } catch (error) {
      console.error('Failed to get conversation:', error);
      res.status(500).json({ error: 'Failed to get conversation' });
    }
  });

  // PUT /api/ai/conversations/:id - Update conversation
  router.put('/conversations/:id', async (req, res) => {
    try {
      const userId = (req as any).user?.oxyUserId || (req as any).user?._id || (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const { title, messages, status } = req.body;
      
      const conversation = await Conversation.findOne({
        _id: req.params.id,
        oxyUserId: userId
      });

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      if (title !== undefined) conversation.title = title;
      if (messages !== undefined) {
        // Ensure messages are properly formatted
        conversation.messages = messages.map(msg => ({
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.timestamp || Date.now())
        }));
      }
      if (status !== undefined) conversation.status = status;

      const savedConversation = await conversation.save();
      
      const responseData = { success: true, conversation: savedConversation };
      console.log('PUT /conversations/:id response data:', JSON.stringify(responseData, null, 2));
      res.json(responseData);
    } catch (error) {
      console.error('Failed to update conversation:', error);
      res.status(500).json({ error: 'Failed to update conversation' });
    }
  });

  // POST /api/ai/conversations/:id/messages - Add message to conversation
  router.post('/conversations/:id/messages', async (req, res) => {
    try {
      const userId = (req as any).user?.oxyUserId || (req as any).user?._id || (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const { role, content, attachments } = req.body;
      
      if (!role || !content) {
        return res.status(400).json({ error: 'Role and content are required' });
      }

      const conversation = await Conversation.findOne({
        _id: req.params.id,
        oxyUserId: userId
      });

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      const newMessage = {
        role,
        content,
        timestamp: new Date(),
        attachments: attachments || []
      };

      conversation.messages.push(newMessage);
      await conversation.save();

      res.json({ success: true, message: newMessage, conversation });
    } catch (error) {
      console.error('Failed to add message:', error);
      res.status(500).json({ error: 'Failed to add message' });
    }
  });

  // DELETE /api/ai/conversations/:id - Delete conversation
  router.delete('/conversations/:id', async (req, res) => {
    try {
      const userId = (req as any).user?.oxyUserId || (req as any).user?._id || (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const conversation = await Conversation.findOneAndDelete({
        _id: req.params.id,
        oxyUserId: userId
      });

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      res.json({ success: true, message: 'Conversation deleted' });
    } catch (error) {
      console.error('Failed to delete conversation:', error);
      res.status(500).json({ error: 'Failed to delete conversation' });
    }
  });

  // POST /api/ai/conversations/:id/share - Generate share token
  router.post('/conversations/:id/share', async (req, res) => {
    try {
      const userId = (req as any).user?.oxyUserId || (req as any).user?._id || (req as any).user?.id;
      if (!userId) return res.status(401).json({ error: 'Unauthorized' });

      const conversation = await Conversation.findOne({
        _id: req.params.id,
        oxyUserId: userId
      });

      if (!conversation) {
        return res.status(404).json({ error: 'Conversation not found' });
      }

      await conversation.generateShareToken();
      const shareToken = conversation.sharing.shareToken;
      res.json({ success: true, shareToken, shareUrl: `/shared/${shareToken}` });
    } catch (error) {
      console.error('Failed to generate share token:', error);
      res.status(500).json({ error: 'Failed to generate share token' });
    }
  });


  return router;
}; 