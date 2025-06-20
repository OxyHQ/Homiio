import { apiService } from '@oxyhq/services';
import { API_URL } from '@/config';
import { Post } from '@/interfaces/Post';
import type { OxyProfile } from '@oxyhq/services/types';

export type FeedType = 'home' | 'profile' | 'explore' | 'hashtag' | 'bookmarks' | 'replies';

interface FeedParams {
    userId?: string;
    hashtag?: string;
    parentId?: string;
    limit?: number;
    cursor?: string;
}

interface FeedResponse {
    data: {
        posts: Post[];
        nextCursor: string | null;
        hasMore: boolean;
    };
}

class FeedService {
    private static instance: FeedService;
    private readonly DEFAULT_LIMIT = 20;
    
    private constructor() {}

    public static getInstance(): FeedService {
        if (!FeedService.instance) {
            FeedService.instance = new FeedService();
        }
        return FeedService.instance;
    }

    async fetchFeed(type: FeedType, params: FeedParams = {}): Promise<FeedResponse["data"]> {
        const { 
            userId, 
            hashtag, 
            parentId, 
            limit = this.DEFAULT_LIMIT, 
            cursor,
        } = params;
        
        let endpoint = '';
        const queryParams: any = { 
            limit, 
            cursor,
        };

        switch (type) {
            case 'home':
                endpoint = 'feed/home';
                break;
            case 'profile':
                if (!userId) throw new Error('userId is required for profile feed');
                endpoint = `feed/user/${userId}`;
                break;
            case 'explore':
                endpoint = 'feed/explore';
                break;
            case 'hashtag':
                if (!hashtag) throw new Error('hashtag is required for hashtag feed');
                endpoint = `feed/hashtag/${encodeURIComponent(hashtag)}`;
                break;
            case 'bookmarks':
                endpoint = 'feed/bookmarks';
                break;
            case 'replies':
                if (!parentId) throw new Error('parentId is required for replies feed');
                endpoint = `feed/replies/${parentId}`;
                break;
            default:
                throw new Error(`Unsupported feed type: ${type}`);
        }

        try {
            const response = await apiService.get<FeedResponse>(endpoint, { params: queryParams });
            return response.data.data;
        } catch (error) {
            console.error(`Error fetching ${type} feed:`, error);
            throw error;
        }
    }
}

export const feedService = FeedService.getInstance();
