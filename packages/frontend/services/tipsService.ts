import { api } from '@/utils/api';

export interface TipArticle {
  id: string;
  title: string;
  description: string;
  category: string;
  readTime: string;
  publishDate: string;
  icon: string;
  gradientColors: string[];
  content: string;
  slug: string;
  author: string;
  tags: string[];
  featured: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface TipsResponse {
  success: boolean;
  data: TipArticle[];
  total: number;
}

export interface TipResponse {
  success: boolean;
  data: TipArticle;
}

export interface SearchParams {
  q?: string;
  category?: string;
  tag?: string;
  limit?: number;
}

class TipsService {
  private baseUrl = '/api/tips';

  // Get all tips
  async getAllTips(): Promise<TipsResponse> {
    try {
      const response = await api.get<TipsResponse>(this.baseUrl);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // Get a single tip by ID or slug
  async getTipById(id: string): Promise<TipResponse> {
    try {
      const response = await api.get<TipResponse>(`${this.baseUrl}/${id}`);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // Get tips by category
  async getTipsByCategory(category: string): Promise<TipsResponse> {
    try {
      const response = await api.get<TipsResponse>(`${this.baseUrl}/category/${category}`);
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // Get featured tips
  async getFeaturedTips(limit: number = 4): Promise<TipsResponse> {
    try {
      const response = await api.get<TipsResponse>(`${this.baseUrl}/featured`, {
        params: { limit },
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // Search tips
  async searchTips(params: SearchParams): Promise<TipsResponse> {
    try {
      const response = await api.get<TipsResponse>(`${this.baseUrl}/search`, {
        params,
      });
      return response.data;
    } catch (error) {
      throw error;
    }
  }

  // Get tips for home page (featured tips)
  async getHomePageTips(): Promise<TipArticle[]> {
    try {
      const response = await this.getFeaturedTips(4);
      return response.data;
    } catch (error) {
      // Return fallback data if API fails
      return this.getFallbackTips();
    }
  }

  // Temporary method to always use fallback data for testing
  async getHomePageTipsFallback(): Promise<TipArticle[]> {
    try {
      return this.getFallbackTips();
    } catch (error) {
      return [];
    }
  }

  // Fallback data in case API fails
  getFallbackTips(): TipArticle[] {
    return [
      {
        id: 'first-time-renting',
        slug: 'first-time-renting-complete-guide',
        title: "First Time Renting? Here's Your Complete Guide",
        description:
          'Everything you need to know about finding, viewing, and securing your first rental property.',
        category: 'search',
        readTime: '5 min read',
        publishDate: '2 days ago',
        icon: 'search',
        gradientColors: ['#0047bf', '#0066ff'],
        author: 'Homiio Team',
        tags: ['first-time', 'renting', 'guide', 'beginners'],
        featured: true,
        createdAt: '2024-01-15T10:00:00Z',
        updatedAt: '2024-01-15T10:00:00Z',
        content:
          "# First Time Renting? Here's Your Complete Guide\n\nRenting your first apartment or house can be both exciting and overwhelming...",
      },
      {
        id: 'avoid-scams',
        slug: 'how-to-avoid-rental-scams',
        title: 'How to Avoid Rental Scams: Red Flags to Watch For',
        description:
          'Learn to identify common rental scams and protect yourself from fraud when searching for a new home.',
        category: 'safety',
        readTime: '7 min read',
        publishDate: '1 week ago',
        icon: 'shield-checkmark',
        gradientColors: ['#16a34a', '#22c55e'],
        author: 'Homiio Team',
        tags: ['scams', 'safety', 'fraud', 'protection'],
        featured: true,
        createdAt: '2024-01-10T14:30:00Z',
        updatedAt: '2024-01-10T14:30:00Z',
        content:
          '# How to Avoid Rental Scams: Red Flags to Watch For\n\nRental scams are unfortunately common...',
      },
      {
        id: 'rental-agreement',
        slug: 'understanding-rental-agreements',
        title: 'Understanding Your Rental Agreement: Key Terms Explained',
        description:
          "Break down complex legal terms and understand what you're signing before committing to a rental.",
        category: 'legal',
        readTime: '8 min read',
        publishDate: '3 days ago',
        icon: 'document-text',
        gradientColors: ['#f59e0b', '#fbbf24'],
        author: 'Homiio Team',
        tags: ['legal', 'contract', 'lease', 'terms'],
        featured: true,
        createdAt: '2024-01-12T09:15:00Z',
        updatedAt: '2024-01-12T09:15:00Z',
        content:
          '# Understanding Your Rental Agreement: Key Terms Explained\n\nYour rental agreement (lease) is a legally binding contract...',
      },
      {
        id: 'property-inspection',
        slug: 'property-inspection-checklist',
        title: 'Property Inspection Checklist: What to Look For',
        description:
          'A comprehensive guide to inspecting potential rental properties and identifying potential issues.',
        category: 'inspection',
        readTime: '6 min read',
        publishDate: '5 days ago',
        icon: 'home',
        gradientColors: ['#8b5cf6', '#a855f7'],
        author: 'Homiio Team',
        tags: ['inspection', 'checklist', 'property', 'viewing'],
        featured: true,
        createdAt: '2024-01-08T16:45:00Z',
        updatedAt: '2024-01-08T16:45:00Z',
        content:
          '# Property Inspection Checklist: What to Look For\n\nA thorough property inspection is crucial before signing a lease...',
      },
    ];
  }
}

export const tipsService = new TipsService();
