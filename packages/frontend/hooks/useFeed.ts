import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { feedService, FeedType } from '@/services/feedService';
import { Post as IPost } from '@/interfaces/Post';
import { getProfileService, apiService } from '@oxyhq/services';
import type { OxyProfile } from '@oxyhq/services/types';
import { queryClient } from '@/lib/reactQuery';

interface UseFeedParams {
  type: FeedType;
  userId?: string;
  hashtag?: string;
  parentId?: string;
  limit?: number;
}

// Define the shape of our feed response
interface FeedResponse {
  posts: IPost[];
  nextCursor: string | null;
  hasMore: boolean;
}

// Initialize global profile cache if it doesn't exist
declare global {
  var profileCache: Map<string, OxyProfile>;
}

if (!global.profileCache) {
  global.profileCache = new Map<string, OxyProfile>();
}

/**
 * React Query hook to fetch and manage feed data
 */
export function useFeed({ type, userId, hashtag, parentId, limit = 20 }: UseFeedParams) {
  // Creates a unique key for the query based on feed parameters
  const getQueryKey = () => ['feed', type, userId, hashtag, parentId];

  // Fetch feed data with pagination
  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    error,
    refetch
  } = useInfiniteQuery<FeedResponse>({
    queryKey: getQueryKey(),
    queryFn: async ({ pageParam }) => {
      const response = await feedService.fetchFeed(type, {
        userId,
        hashtag,
        parentId,
        limit,
        cursor: pageParam as string | undefined
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
    initialPageParam: undefined as string | undefined
  });

  // Flatten the pages data for easier consumption in components
  const flattenedPosts = data?.pages.flatMap((page: FeedResponse) => page.posts) || [];

  // Mutation for liking a post
  const likeMutation = useMutation({
    mutationFn: async ({ postId, isLiked }: { postId: string; isLiked: boolean }) => {
      if (isLiked) {
        return await apiService.post(`posts/${postId}/like`);
      } else {
        return await apiService.delete(`posts/${postId}/like`);
      }
    },
    onMutate: async ({ postId, isLiked }) => {
      // Cancel ongoing queries for this feed
      await queryClient.cancelQueries({ queryKey: getQueryKey() });

      // Get current data
      const previousData = queryClient.getQueryData(getQueryKey());

      // Optimistically update the post
      queryClient.setQueryData(
        getQueryKey(),
        (old: any) => {
          if (!old?.pages) return old;
          
          return {
            ...old,
            pages: old.pages.map((page: FeedResponse) => ({
              ...page,
              posts: page.posts.map((post: IPost) => {
                if (post.id === postId) {
                  const likesCount = (post._count?.likes || 0) + (isLiked ? 1 : -1);
                  return {
                    ...post,
                    isLiked,
                    _count: { ...post._count, likes: likesCount >= 0 ? likesCount : 0 }
                  };
                }
                return post;
              })
            }))
          };
        }
      );

      return { previousData };
    },
    onError: (err, { postId, isLiked }, context) => {
      // Revert to previous state on error
      if (context?.previousData) {
        queryClient.setQueryData(getQueryKey(), context.previousData);
      }
    }
  });

  // Mutation for reposting
  const repostMutation = useMutation({
    mutationFn: async ({ postId, isReposted }: { postId: string; isReposted: boolean }) => {
      if (isReposted) {
        return await apiService.post(`posts/${postId}/repost`);
      } else {
        return await apiService.delete(`posts/${postId}/repost`);
      }
    },
    onMutate: async ({ postId, isReposted }) => {
      await queryClient.cancelQueries({ queryKey: getQueryKey() });
      const previousData = queryClient.getQueryData(getQueryKey());

      queryClient.setQueryData(
        getQueryKey(),
        (old: any) => {
          if (!old?.pages) return old;
          
          return {
            ...old,
            pages: old.pages.map((page: FeedResponse) => ({
              ...page,
              posts: page.posts.map((post: IPost) => {
                if (post.id === postId) {
                  const repostsCount = (post._count?.reposts || 0) + (isReposted ? 1 : -1);
                  return {
                    ...post,
                    isReposted,
                    _count: { ...post._count, reposts: repostsCount >= 0 ? repostsCount : 0 }
                  };
                }
                return post;
              })
            }))
          };
        }
      );

      return { previousData };
    },
    onError: (err, { postId, isReposted }, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(getQueryKey(), context.previousData);
      }
    }
  });

  // Mutation for bookmarking
  const bookmarkMutation = useMutation({
    mutationFn: async ({ postId, isBookmarked }: { postId: string; isBookmarked: boolean }) => {
      if (isBookmarked) {
        return await apiService.post(`posts/${postId}/bookmark`);
      } else {
        return await apiService.delete(`posts/${postId}/bookmark`);
      }
    },
    onMutate: async ({ postId, isBookmarked }) => {
      await queryClient.cancelQueries({ queryKey: getQueryKey() });
      const previousData = queryClient.getQueryData(getQueryKey());

      queryClient.setQueryData(
        getQueryKey(),
        (old: any) => {
          if (!old?.pages) return old;
          
          return {
            ...old,
            pages: old.pages.map((page: FeedResponse) => ({
              ...page,
              posts: page.posts.map((post: IPost) => {
                if (post.id === postId) {
                  const bookmarksCount = (post._count?.bookmarks || 0) + (isBookmarked ? 1 : -1);
                  return {
                    ...post,
                    isBookmarked,
                    _count: { ...post._count, bookmarks: bookmarksCount >= 0 ? bookmarksCount : 0 }
                  };
                }
                return post;
              })
            }))
          };
        }
      );

      return { previousData };
    },
    onError: (err, { postId, isBookmarked }, context) => {
      if (context?.previousData) {
        queryClient.setQueryData(getQueryKey(), context.previousData);
      }
    }
  });

  // Add a new post to the feed (used with socket updates)
  const addPost = (newPost: IPost) => {
    queryClient.setQueryData(
      getQueryKey(),
      (old: any) => {
        if (!old?.pages?.length) return old;
        
        // Check if post already exists
        const exists = old.pages.some((page: FeedResponse) => 
          page.posts.some((post: IPost) => post.id === newPost.id)
        );
        
        if (exists) return old;

        // Add the new post at the beginning of the first page
        return {
          ...old,
          pages: [
            {
              ...old.pages[0],
              posts: [newPost, ...old.pages[0].posts]
            },
            ...old.pages.slice(1)
          ]
        };
      }
    );
  };

  // Update a post in the feed (used with socket updates)
  const updatePost = (postId: string, updates: Partial<IPost>) => {
    queryClient.setQueryData(
      getQueryKey(),
      (old: any) => {
        if (!old?.pages?.length) return old;
        
        return {
          ...old,
          pages: old.pages.map((page: FeedResponse) => ({
            ...page,
            posts: page.posts.map((post: IPost) => {
              if (post.id === postId) {
                return { ...post, ...updates };
              }
              return post;
            })
          }))
        };
      }
    );
  };

  // Remove a post from the feed (used with socket updates)
  const removePost = (postId: string) => {
    queryClient.setQueryData(
      getQueryKey(),
      (old: any) => {
        if (!old?.pages?.length) return old;
        
        return {
          ...old,
          pages: old.pages.map((page: FeedResponse) => ({
            ...page,
            posts: page.posts.filter((post: IPost) => post.id !== postId)
          }))
        };
      }
    );
  };

  return {
    posts: flattenedPosts,
    isLoading,
    isError,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch,
    likeMutation,
    repostMutation,
    bookmarkMutation,
    addPost,
    updatePost,
    removePost
  };
}