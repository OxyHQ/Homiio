import { useEffect, useRef, useContext, useCallback } from 'react';
import { io, Socket } from "socket.io-client";
import { SOCKET_URL } from "@/config";
import { FeedType } from '@/services/feedService';
import { Post as IPost } from '@/interfaces/Post';
import { SessionContext } from '@oxyhq/services/components/SessionProvider';
import { getProfileService } from '@oxyhq/services';
import { 
  addPostToFeed, 
  updatePostInFeed, 
  removePostFromFeed 
} from './feedQueries';

interface UseSocketFeedParams {
  type: FeedType;
  userId?: string;
  hashtag?: string;
  parentId?: string;
  onNewPost?: (post: IPost) => void;
}

/**
 * Hook to manage socket connections for real-time feed updates
 */
export function useSocketFeed({
  type,
  userId,
  hashtag,
  parentId,
  onNewPost
}: UseSocketFeedParams) {
  const socketRef = useRef<Socket | null>(null);
  const session = useContext(SessionContext);
  
  const initializeSocket = useCallback(() => {
    // Don't initialize socket if user is not authenticated
    if (!session?.getCurrentUserId()) {
      return () => {}; // Return empty cleanup function
    }
    
    console.log('Initializing socket connection to:', `${SOCKET_URL}/api/posts`);
    
    // Initialize socket connection
    socketRef.current = io(`${SOCKET_URL}/api/posts`, {
      query: {
        userId: session.getCurrentUserId(),
        feedType: type,
        ...(userId && { targetUserId: userId }),
        ...(hashtag && { hashtag }),
        ...(parentId && { parentId })
      }
    });
    
    // Handle socket connection events
    socketRef.current.on('connect', () => {
      console.log('Socket connected successfully');
    });
    
    socketRef.current.on('connect_error', (error) => {
      console.error('Socket connection error:', error);
    });
    
    // Handle new post events
    socketRef.current.on('newPost', async (data: { post: IPost }) => {
      console.log('Received new post:', data);
      try {
        if (data.post.author?.id) {
          // Check cache first
          let profile = global.profileCache?.get(data.post.author.id);
          
          if (!profile) {
            // Use profileService for more comprehensive profile data
            const profileService = getProfileService();
            profile = await profileService.getProfileById(data.post.author.id);
            // Update cache
            if (global.profileCache) {
              global.profileCache.set(data.post.author.id, profile);
            }
          }
          
          data.post.author = {
            ...data.post.author,
            ...profile
          };
        }
        
        // Add the new post to all feeds using the centralized method
        addPostToFeed(data.post.id, data.post);

        // Notify listeners if provided
        if (onNewPost) {
          onNewPost(data.post);
        }
      } catch (error) {
        console.error('Error processing socket post:', error);
      }
    });
    
    // Handle post update events
    socketRef.current.on('postUpdate', async (data: { 
      type: string; 
      postId: string; 
      userId: string; 
      _count: any 
    }) => {
      const isCurrentUser = session?.getCurrentUserId() === data.userId;
      let updates: Partial<IPost> = { _count: data._count };

      switch (data.type) {
        case 'like':
          updates = { 
            ...updates,
            isLiked: isCurrentUser ? true : undefined
          };
          break;
        case 'unlike':
          updates = { 
            ...updates,
            isLiked: isCurrentUser ? false : undefined
          };
          break;
        case 'bookmark':
          updates = { 
            ...updates,
            isBookmarked: isCurrentUser ? true : undefined
          };
          break;
        case 'unbookmark':
          updates = { 
            ...updates,
            isBookmarked: isCurrentUser ? false : undefined
          };
          break;
        case 'repost':
          updates = { 
            ...updates,
            isReposted: isCurrentUser ? true : undefined
          };
          break;
        case 'unrepost':
          updates = { 
            ...updates,
            isReposted: isCurrentUser ? false : undefined
          };
          break;
      }

      // Update the post in all feeds using the centralized method
      updatePostInFeed(data.postId, updates);
    });
    
    // Handle post deletion events
    socketRef.current.on('postDelete', (deletedPostId: string) => {
      // Remove the post from all feeds using the centralized method
      removePostFromFeed(deletedPostId);
    });
    
    // Return cleanup function
    return () => {
      console.log('Cleaning up socket connection');
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [type, userId, hashtag, parentId, session, onNewPost]);
  
  // Initialize socket on component mount and clean up on unmount
  useEffect(() => {
    const cleanup = initializeSocket();
    return cleanup;
  }, [initializeSocket]);
  
  return socketRef.current;
}