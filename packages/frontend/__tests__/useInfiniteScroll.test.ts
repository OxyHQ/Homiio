/**
 * The explore results list pages through its own scroller on every platform,
 * so its end detection has to cover the case a scroll handler alone cannot: a
 * page shorter than the list, which never scrolls.
 */
import { renderHook } from '@testing-library/react-native';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent } from 'react-native';

import { useInfiniteScroll } from '@/hooks/useInfiniteScroll';

const layout = (height: number) =>
  ({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height } } }) as LayoutChangeEvent;

const scroll = (offset: number, viewport: number, content: number) =>
  ({
    nativeEvent: {
      contentOffset: { x: 0, y: offset },
      layoutMeasurement: { width: 400, height: viewport },
      contentSize: { width: 400, height: content },
    },
  }) as NativeSyntheticEvent<NativeScrollEvent>;

function list(enabled = true) {
  const onEndReached = jest.fn();
  const { result } = renderHook(() => useInfiniteScroll({ onEndReached, enabled }));
  return { onEndReached, handlers: () => result.current };
}

describe('useInfiniteScroll', () => {
  it('asks for more when a page is too short to scroll', () => {
    const { onEndReached, handlers } = list();
    handlers().onLayout(layout(800));
    handlers().onContentSizeChange(400, 500);
    expect(onEndReached).toHaveBeenCalledTimes(1);
  });

  it('asks again only once the content has grown, while it is still short', () => {
    const { onEndReached, handlers } = list();
    handlers().onLayout(layout(800));
    handlers().onContentSizeChange(400, 500);
    handlers().onLayout(layout(800));
    expect(onEndReached).toHaveBeenCalledTimes(1);

    handlers().onContentSizeChange(400, 700);
    expect(onEndReached).toHaveBeenCalledTimes(2);
  });

  it('fires once per approach to the end while scrolling, and re-arms above it', () => {
    const { onEndReached, handlers } = list();
    handlers().onScroll(scroll(0, 800, 4000));
    expect(onEndReached).not.toHaveBeenCalled();

    handlers().onScroll(scroll(2200, 800, 4000));
    handlers().onScroll(scroll(2300, 800, 4000));
    expect(onEndReached).toHaveBeenCalledTimes(1);

    handlers().onScroll(scroll(500, 800, 4000));
    handlers().onScroll(scroll(2200, 800, 4000));
    expect(onEndReached).toHaveBeenCalledTimes(2);
  });

  it('never pages a scroll view as tall as its content, which scrolls nothing', () => {
    // A parent that gives the list no height: each page grows the viewport with
    // the content, so "at the end" would hold after every page, forever.
    const { onEndReached, handlers } = list();
    handlers().onContentSizeChange(400, 2905);
    handlers().onLayout(layout(2905));
    handlers().onContentSizeChange(400, 5810);
    handlers().onLayout(layout(5810));
    expect(onEndReached).not.toHaveBeenCalled();
  });

  it('never fires while there is nothing more to load, and never for empty content', () => {
    const { onEndReached, handlers } = list(false);
    handlers().onLayout(layout(800));
    handlers().onContentSizeChange(400, 500);
    handlers().onScroll(scroll(0, 800, 0));
    expect(onEndReached).not.toHaveBeenCalled();
  });
});
