export interface SitemapUrl {
  url: string;
  lastModified?: Date;
  changeFrequency?: 'always' | 'hourly' | 'daily' | 'weekly' | 'monthly' | 'yearly' | 'never';
  priority?: number;
}

export function generateSitemap(urls: SitemapUrl[]): string {
  const baseUrl = 'https://homiio.com';
  
  const sitemap = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => {
  const fullUrl = url.url.startsWith('http') ? url.url : `${baseUrl}${url.url}`;
  const lastMod = url.lastModified ? url.lastModified.toISOString() : new Date().toISOString();
  const changeFreq = url.changeFrequency || 'weekly';
  const priority = url.priority || 0.5;
  
  return `  <url>
    <loc>${fullUrl}</loc>
    <lastmod>${lastMod}</lastmod>
    <changefreq>${changeFreq}</changefreq>
    <priority>${priority}</priority>
  </url>`;
}).join('\n')}
</urlset>`;

  return sitemap;
}

export function generateRobotsTxt(sitemapUrl: string = 'https://homiio.com/sitemap.xml'): string {
  return `User-agent: *
Allow: /

# Sitemap
Sitemap: ${sitemapUrl}

# Disallow admin and private areas
Disallow: /admin/
Disallow: /private/
Disallow: /api/
Disallow: /_next/

# Allow important pages
Allow: /properties/
Allow: /search/
Allow: /about/
Allow: /contact/
Allow: /help/
`;
}

export function injectSitemapData(urls: SitemapUrl[]) {
  if (typeof document !== 'undefined') {
    // Create sitemap link
    let sitemapLink = document.querySelector('link[rel="sitemap"]') as HTMLLinkElement;
    if (!sitemapLink) {
      sitemapLink = document.createElement('link');
      sitemapLink.setAttribute('rel', 'sitemap');
      sitemapLink.setAttribute('type', 'application/xml+sitemap');
      document.head.appendChild(sitemapLink);
    }
    sitemapLink.setAttribute('href', '/sitemap.xml');
  }
}

// Default sitemap URLs for the app
export const defaultSitemapUrls: SitemapUrl[] = [
  { url: '/', priority: 1.0, changeFrequency: 'daily' },
  { url: '/properties', priority: 0.9, changeFrequency: 'daily' },
  { url: '/search', priority: 0.8, changeFrequency: 'weekly' },
  { url: '/saved', priority: 0.7, changeFrequency: 'weekly' },
  { url: '/profile', priority: 0.6, changeFrequency: 'monthly' },
  { url: '/about', priority: 0.5, changeFrequency: 'monthly' },
  { url: '/contact', priority: 0.5, changeFrequency: 'monthly' },
  { url: '/help', priority: 0.4, changeFrequency: 'monthly' },
  { url: '/privacy', priority: 0.3, changeFrequency: 'yearly' },
  { url: '/terms', priority: 0.3, changeFrequency: 'yearly' },
]; 