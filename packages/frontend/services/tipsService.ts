import { WEBSITE_API_URL } from '@/config';

export interface TipArticle {
  slug: string;
  title: string;
  description: string;
  content: string;
  coverImageUrl: string | null;
  author: string;
  tags: string[];
  category: string;
  featured: boolean;
  publishedAt: string;
  readTime: string;
}

interface NewsroomCoverImage {
  url?: string;
  alt?: string;
}

interface NewsroomPost {
  slug: string;
  title: string;
  resume?: string;
  description?: string;
  content: string;
  coverImage?: NewsroomCoverImage | null;
  imageAlt?: string;
  tags?: string[];
  categories?: string[];
  featured?: boolean;
  publishedAt?: string;
  author?: string;
  createdAt?: string;
}

interface NewsroomListResponse {
  posts: NewsroomPost[];
  total: number;
}

export interface TipsListResult {
  data: TipArticle[];
  total: number;
}

export interface TipsQueryParams {
  tag?: string;
  search?: string;
  locale?: string;
}

const HOMIIO_PRODUCT = 'homiio';
const TIPS_CATEGORY = 'Tips';

/**
 * Map Homiio i18n codes (`en-US`, `es-ES`, `ca-ES`, `it-IT`) to Newsroom
 * locale codes (`en`, `es`, `ca`, `it`). Unknown / empty → `en`.
 */
export function toNewsroomLocale(language: string | undefined | null): string {
  if (!language) return 'en';
  const base = language.split('-')[0]?.toLowerCase().trim();
  if (!base) return 'en';
  return base;
}

function deriveReadTime(content: string): string {
  const words = content.trim().split(/\s+/).filter(Boolean).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return `${minutes} min read`;
}

function formatPublishDate(isoDate?: string): string {
  if (!isoDate) return '';
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function mapNewsroomPost(post: NewsroomPost): TipArticle {
  const category = post.categories?.[0] ?? TIPS_CATEGORY;
  const description = post.resume?.trim() || post.description?.trim() || '';
  const content = post.content ?? '';
  const publishedAt = post.publishedAt ?? post.createdAt ?? '';

  return {
    slug: post.slug,
    title: post.title,
    description,
    content,
    coverImageUrl: post.coverImage?.url ?? null,
    author: post.author?.trim() || 'Homiio',
    tags: post.tags ?? [],
    category,
    featured: post.featured ?? false,
    publishedAt,
    readTime: deriveReadTime(content),
  };
}

class TipsService {
  private baseUrl = `${WEBSITE_API_URL}/api/newsroom`;

  private buildListUrl(params?: TipsQueryParams): string {
    const search = new URLSearchParams({
      product: HOMIIO_PRODUCT,
      category: TIPS_CATEGORY,
    });
    if (params?.tag) search.set('tag', params.tag);
    if (params?.search) search.set('search', params.search);
    if (params?.locale) search.set('locale', params.locale);
    return `${this.baseUrl}?${search.toString()}`;
  }

  async getTips(params?: TipsQueryParams): Promise<TipsListResult> {
    const response = await fetch(this.buildListUrl(params));
    if (!response.ok) {
      throw new Error(`Failed to load tips (${response.status})`);
    }
    const payload = (await response.json()) as NewsroomListResponse;
    return {
      data: payload.posts.map(mapNewsroomPost),
      total: payload.total,
    };
  }

  async getTipBySlug(slug: string, locale?: string): Promise<TipArticle> {
    const search = new URLSearchParams();
    if (locale) search.set('locale', locale);
    const qs = search.toString();
    const url = qs
      ? `${this.baseUrl}/${encodeURIComponent(slug)}?${qs}`
      : `${this.baseUrl}/${encodeURIComponent(slug)}`;
    const response = await fetch(url);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error('Article not found');
      }
      throw new Error(`Failed to load tip (${response.status})`);
    }
    const post = (await response.json()) as NewsroomPost;
    return mapNewsroomPost(post);
  }
}

export const tipsService = new TipsService();

export { formatPublishDate };
