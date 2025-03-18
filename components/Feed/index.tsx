import React, { memo, useCallback, useState, useRef } from "react";
import { View, Text, ActivityIndicator, Platform, NativeSyntheticEvent, NativeScrollEvent } from "react-native";
import { CreatePost } from "../CreatePost";
import { Loading } from "@/assets/icons/loading-icon";
import { Post as IPost } from "@/interfaces/Post";
import Post from "@/components/Post";
import { FeedType } from "@/services/feedService";
import { usePostFeedQuery, FeedRow } from "@/hooks/feedQueries";
import { useSocketFeed } from "@/hooks/useSocketFeed";
import { List } from "./List";

interface FeedProps {
  type: FeedType;
  userId?: string;
  hashtag?: string;
  parentId?: string;
  showCreatePost?: boolean;
  className?: string;
  enabled?: boolean;
  renderEmptyState?: () => JSX.Element;
  renderError?: (error: Error) => JSX.Element;
  headerOffset?: number;
  progressViewOffset?: number;
  ListHeaderComponent?: React.ComponentType<any> | React.ReactElement;
  scrollElRef?: React.RefObject<any>;
  onScrolledDownChange?: (isScrolledDown: boolean) => void;
  onHasNewPosts?: (hasNew: boolean) => void;
  limit?: number;
  extraData?: any;
  initialNumToRender?: number;
  testID?: string;
}

/**
 * Feed component using React Query and List virtualization for efficient rendering
 */
function Feed({
  type,
  userId,
  hashtag,
  parentId,
  showCreatePost = true,
  className = "",
  enabled = true,
  renderEmptyState,
  renderError,
  headerOffset = 0,
  progressViewOffset,
  ListHeaderComponent,
  scrollElRef,
  onScrolledDownChange,
  onHasNewPosts,
  limit = 20,
  extraData,
  initialNumToRender = 10,
  testID
}: FeedProps) {
  const [isPTRing, setIsPTRing] = useState(false);
  const hasNewPostsRef = useRef(false);
  const listRef = useRef<any>(null);
  
  // Use the provided scrollElRef or fall back to our local ref
  const resolvedRef = scrollElRef || listRef;

  // Use our custom React Query hook for feed data
  const {
    feedItems,
    isLoading,
    isError,
    error,
    hasNextPage,
    isFetchingNextPage,
    fetchNextPage,
    refetch
  } = usePostFeedQuery({
    type,
    userId,
    hashtag,
    parentId,
    limit,
    enabled
  });

  // Use our socket hook for real-time updates
  useSocketFeed({
    type,
    userId,
    hashtag,
    parentId,
    onNewPost: (post) => {
      hasNewPostsRef.current = true;
      onHasNewPosts?.(true);
    }
  });

  // Handle pull-to-refresh
  const handleRefresh = useCallback(async () => {
    setIsPTRing(true);
    try {
      await refetch();
      hasNewPostsRef.current = false;
      onHasNewPosts?.(false);
    } catch (error) {
      console.error('Failed to refresh feed:', error);
    } finally {
      setIsPTRing(false);
    }
  }, [refetch, onHasNewPosts]);

  // Load more posts when scrolling to bottom
  const handleLoadMore = useCallback(() => {
    if (!isFetchingNextPage && hasNextPage && !isLoading) {
      fetchNextPage();
    }
  }, [isFetchingNextPage, hasNextPage, isLoading, fetchNextPage]);

  // Render a specific feed row based on its type
  const renderItem = useCallback(({ item }: { item: FeedRow }) => {
    if (item.type === 'post') {
      return <Post postData={item.post} />;
    } else if (item.type === 'empty') {
      return renderEmptyState ? 
        renderEmptyState() : 
        <View className="flex-1 justify-center items-center p-5">
          <Text className="text-gray-500">No posts to display</Text>
        </View>;
    } else if (item.type === 'error') {
      return renderError ? 
        renderError(item.error) : 
        <View className="flex-1 justify-center items-center">
          <Text className="text-red-500 text-base">
            {item.error.message || 'Failed to load posts'}
          </Text>
        </View>;
    } else { // 'loading'
      return <Loading size={40} />;
    }
  }, [renderEmptyState, renderError]);

  // Render the footer with loading indicator or spacing
  const FeedFooter = useCallback(() => {
    const offset = Math.max(headerOffset, 20);
    
    return (
      <View style={{ paddingTop: 20, paddingBottom: offset }}>
        {isFetchingNextPage && <ActivityIndicator color="#007AFF" />}
      </View>
    );
  }, [isFetchingNextPage, headerOffset]);

  return (
    <View 
      className={`flex flex-col flex-1 rounded-[35px] overflow-hidden ${className}`}
      testID={testID}
    >
      {showCreatePost && <CreatePost />}
      
      <List
        ref={resolvedRef}
        data={feedItems}
        renderItem={renderItem}
        keyExtractor={(item: FeedRow) => item.key}
        onEndReached={handleLoadMore}
        onEndReachedThreshold={0.5}
        onRefresh={handleRefresh}
        refreshing={isPTRing}
        estimatedItemSize={200}
        removeClippedSubviews={Platform.OS !== 'web'}
        className="flex-1"
        ListFooterComponent={FeedFooter}
        ListHeaderComponent={ListHeaderComponent}
        onScrollBeginDrag={() => onScrolledDownChange?.(true)}
        onMomentumScrollEnd={(event: NativeSyntheticEvent<NativeScrollEvent>) => {
          const isScrolledDown = event.nativeEvent.contentOffset.y <= 0;
          onScrolledDownChange?.(isScrolledDown);
        }}
        extraData={extraData}
        initialNumToRender={initialNumToRender}
        progressViewOffset={progressViewOffset}
        testID={testID ? `${testID}-list` : undefined}
      />
    </View>
  );
}

// Memoize the component to prevent unnecessary re-renders
export default memo(Feed);
