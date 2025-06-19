import { useInfiniteQuery, useMutation, InfiniteData } from '@tanstack/react-query';
import { feedService, FeedType } from '@/services/feedService';
import { Post as IPost } from '@/interfaces/Post';
import { getProfileService, apiService } from '@oxyhq/services';
import type { OxyProfile } from '@oxyhq/services/types';
import { queryClient } from '@/lib/reactQuery';

// Define the shape of our feed response
interface FeedResponse {
  posts: IPost[];
  nextCursor: string | null;
  hasMore: boolean;
}

/**
 * Type representing the various types of rows that can appear in a feed
 */
export type FeedRow =
  | { type: 'post'; post: IPost; key: string }
  | { type: 'empty'; key: string }
  | { type: 'loading'; key: string }
  | { type: 'error'; error: Error; key: string };

/**
 * Feed query parameters
 */
export interface FeedQueryParams {
  type: FeedType;
  userId?: string;
  hashtag?: string;
  parentId?: string;
  limit?: number;
  enabled?: boolean;
}

/**
 * Initialize global profile cache if it doesn't exist
 */
declare global {
  var profileCache: Map<string, OxyProfile>;
}

if (!global.profileCache) {
  global.profileCache = new Map<string, OxyProfile>();
}

/**
 * Transforms feed data into renderable rows
 */
export function getItemsForFeed(
  data: InfiniteData<FeedResponse> | undefined,
  isLoading: boolean,
  isError: boolean,
  error: Error | null
): FeedRow[] {
  if (isError && error) {
    return [{ type: 'error', error, key: 'error' }];
  }

  if (isLoading && (!data || data.pages.length === 0)) {
    return [{ type: 'loading', key: 'loading' }];
  }

  if (!data || !data.pages.length) {
    return [{ type: 'empty', key: 'empty' }];
  }

  // Flatten posts from all pages
  const posts = data.pages.flatMap(page => 
    page.posts.map(post => ({ type: 'post', post, key: post.id } as FeedRow))
  );

  return posts.length ? posts : [{ type: 'empty', key: 'empty' }];
}

/**
 * React Query hook for post feed
 */
export function usePostFeedQuery({ 
  type, 
  userId, 
  hashtag, 
  parentId, 
  limit = 20,
  enabled = true 
}: FeedQueryParams) {
  // Create a unique key for the query
  const queryKey = ['feed', type, userId, hashtag, parentId];

  const queryResult = useInfiniteQuery<FeedResponse>({
    queryKey,
    queryFn: async ({ pageParam }) => {
      const response = await feedService.fetchFeed(type, {
        userId,
        hashtag,
        parentId,
        limit,
        cursor: pageParam as string | undefined,
      });

      // Enhance posts with author profiles
      const postsWithProfiles = await Promise.all(
        response.posts.map(async (post) => {
          if (post.author?.id) {
            try {
              // Check cache first
              let profile = global.profileCache.get(post.author.id);

              if (!profile) {
                // Use profileService for profile data
                const profileService = getProfileService();
                profile = await profileService.getProfileById(post.author.id);
                
                // Update cache
                global.profileCache.set(post.author.id, profile);
              }

              return {
                ...post,
                author: {
                  ...post.author,
                  ...profile
                }
              };
            } catch (error) {
              console.error('Error fetching post author profile:', error);
              return post;
            }
          }
          return post;
        })
      );

      return {
        posts: postsWithProfiles,
        nextCursor: response.nextCursor,
        hasMore: response.hasMore
      };
    },
    getNextPageParam: (lastPage) => lastPage.hasMore ? lastPage.nextCursor : undefined,
    initialPageParam: undefined as string | undefined,
    enabled
  });

  // Transform the data into renderable items
  const feedItems = getItemsForFeed(
    queryResult.data,
    queryResult.isLoading,
    queryResult.isError,
    queryResult.error as Error | null
  );

  return {
    ...queryResult,
    feedItems
  };
}

/**
 * Mutation for liking a post
 */
export function useLikeMutation() {
  return useMutation({
    mutationFn: async ({ postId, isLiked }: { postId: string; isLiked: boolean }) => {
      if (isLiked) {
        return await apiService.post(`posts/${postId}/like`);
      } else {
        return await apiService.delete(`posts/${postId}/like`);
      }
    },
    onMutate: async ({ postId, isLiked }) => {
      // Find all feed queries
      const feedQueries = queryClient.getQueriesData({ 
        queryKey: ['feed'] 
      });
      
      // Cancel any outgoing refetches
      await Promise.all(
        feedQueries.map(([queryKey]) => 
          queryClient.cancelQueries({ queryKey })
        )
      );

      // Store previous data for rollback
      const previousData = feedQueries.map(([queryKey]) => ({
        queryKey,
        data: queryClient.getQueryData(queryKey as any)
      }));

      // Optimistically update all affected queries
      feedQueries.forEach(([queryKey]) => {
        queryClient.setQueryData(queryKey, (oldData: any) => {
          if (!oldData?.pages?.length) return oldData;
          
          return {
            ...oldData,
            pages: oldData.pages.map((page: any) => ({
              ...page,
              posts: page.posts.map((post: IPost) => {
                if (post.id === postId) {
                  const likesCount = (post._count?.likes || 0) + (isLiked ? 1 : -1);
                  return {
                    ...post,
                    isLiked,
                    _count: { ...post._count, likes: Math.max(0, likesCount) }
                  };
                }
                return post;
              })
            }))
          };
        });
      });

      return { previousData };
    },
    onError: (err, { postId, isLiked }, context) => {
      // Roll back on error
      if (context?.previousData) {
        context.previousData.forEach(({ queryKey, data }) => {
          if (data) queryClient.setQueryData(queryKey, data);
        });
      }
    }
  });
}

/**
 * Mutation for reposting
 */
export function useRepostMutation() {
  return useMutation({
    mutationFn: async ({ postId, isReposted }: { postId: string; isReposted: boolean }) => {
      if (isReposted) {
        return await apiService.post(`posts/${postId}/repost`);
      } else {
        return await apiService.delete(`posts/${postId}/repost`);
      }
    },
    onMutate: async ({ postId, isReposted }) => {
      // Find all feed queries
      const feedQueries = queryClient.getQueriesData({ 
        queryKey: ['feed'] 
      });
      
      // Cancel any outgoing refetches
      await Promise.all(
        feedQueries.map(([queryKey]) => 
          queryClient.cancelQueries({ queryKey })
        )
      );

      // Store previous data for rollback
      const previousData = feedQueries.map(([queryKey]) => ({
        queryKey,
        data: queryClient.getQueryData(queryKey as any)
      }));

      // Optimistically update all affected queries
      feedQueries.forEach(([queryKey]) => {
        queryClient.setQueryData(queryKey, (oldData: any) => {
          if (!oldData?.pages) return oldData;
          
          return {
            ...oldData,
            pages: oldData.pages.map((page: any) => ({
              ...page,
              posts: page.posts.map((post: IPost) => {
                if (post.id === postId) {
                  const repostsCount = (post._count?.reposts || 0) + (isReposted ? 1 : -1);
                  return {
                    ...post,
                    isReposted,
                    _count: { ...post._count, reposts: Math.max(0, repostsCount) }
                  };
                }
                return post;
              })
            }))
          };
        });
      });

      return { previousData };
    },
    onError: (err, { postId, isReposted }, context) => {
      // Roll back on error
      if (context?.previousData) {
        context.previousData.forEach(({ queryKey, data }) => {
          if (data) queryClient.setQueryData(queryKey, data);
        });
      }
    }
  });
}

/**
 * Mutation for bookmarking
 */
export function useBookmarkMutation() {
  return useMutation({
    mutationFn: async ({ postId, isBookmarked }: { postId: string; isBookmarked: boolean }) => {
      if (isBookmarked) {
        return await apiService.post(`posts/${postId}/bookmark`);
      } else {
        return await apiService.delete(`posts/${postId}/bookmark`);
      }
    },
    onMutate: async ({ postId, isBookmarked }) => {
      // Find all feed queries
      const feedQueries = queryClient.getQueriesData({ 
        queryKey: ['feed'] 
      });
      
      // Cancel any outgoing refetches
      await Promise.all(
        feedQueries.map(([queryKey]) => 
          queryClient.cancelQueries({ queryKey })
        )
      );

      // Store previous data for rollback
      const previousData = feedQueries.map(([queryKey]) => ({
        queryKey,
        data: queryClient.getQueryData(queryKey as any)
      }));

      // Optimistically update all affected queries
      feedQueries.forEach(([queryKey]) => {
        queryClient.setQueryData(queryKey, (oldData: any) => {
          if (!oldData?.pages) return oldData;
          
          return {
            ...oldData,
            pages: oldData.pages.map((page: any) => ({
              ...page,
              posts: page.posts.map((post: IPost) => {
                if (post.id === postId) {
                  const bookmarksCount = (post._count?.bookmarks || 0) + (isBookmarked ? 1 : -1);
                  return {
                    ...post,
                    isBookmarked,
                    _count: { ...post._count, bookmarks: Math.max(0, bookmarksCount) }
                  };
                }
                return post;
              })
            }))
          };
        });
      });

      return { previousData };
    },
    onError: (err, { postId, isBookmarked }, context) => {
      // Roll back on error
      if (context?.previousData) {
        context.previousData.forEach(({ queryKey, data }) => {
          if (data) queryClient.setQueryData(queryKey, data);
        });
      }
    }
  });
}

/**
 * Functions to manipulate feed data (used with socket updates)
 */

export function addPostToFeed(postId: string, newPost: IPost) {
  const feedQueries = queryClient.getQueriesData({ 
    queryKey: ['feed'] 
  });
  
  feedQueries.forEach(([queryKey]) => {
    queryClient.setQueryData(queryKey, (oldData: any) => {
      if (!oldData?.pages?.length) return oldData;
      
      // Check if post already exists
      const exists = oldData.pages.some((page: any) => 
        page.posts.some((post: IPost) => post.id === postId)
      );
      
      if (exists) return oldData;

      // Add the new post at the beginning of the first page
      return {
        ...oldData,
        pages: [
          {
            ...oldData.pages[0],
            posts: [newPost, ...oldData.pages[0].posts]
          },
          ...oldData.pages.slice(1)
        ]
      };
    });
  });
}

export function updatePostInFeed(postId: string, updates: Partial<IPost>) {
  const feedQueries = queryClient.getQueriesData({ 
    queryKey: ['feed'] 
  });
  
  feedQueries.forEach(([queryKey]) => {
    queryClient.setQueryData(queryKey, (oldData: any) => {
      if (!oldData?.pages?.length) return oldData;
      
      return {
        ...oldData,
        pages: oldData.pages.map((page: any) => ({
          ...page,
          posts: page.posts.map((post: IPost) => {
            if (post.id === postId) {
              return { ...post, ...updates };
            }
            return post;
          })
        }))
      };
    });
  });
}

export function removePostFromFeed(postId: string) {
  const feedQueries = queryClient.getQueriesData({ 
    queryKey: ['feed'] 
  });
  
  feedQueries.forEach(([queryKey]) => {
    queryClient.setQueryData(queryKey, (oldData: any) => {
      if (!oldData?.pages?.length) return oldData;
      
      return {
        ...oldData,
        pages: oldData.pages.map((page: any) => ({
          ...page,
          posts: page.posts.filter((post: IPost) => post.id !== postId)
        }))
      };
    });
  });
}