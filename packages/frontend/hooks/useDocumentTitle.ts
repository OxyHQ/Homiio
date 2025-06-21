import { useEffect } from 'react';
import { Platform } from 'react-native';

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  url?: string;
  type?: 'website' | 'article' | 'property';
  // Social media specific props
  twitterHandle?: string;
  author?: string;
  publishedTime?: string;
  modifiedTime?: string;
  section?: string;
  tags?: string[];
}

export function useDocumentTitle(title: string) {
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const baseTitle = 'Homiio';
      const fullTitle = title ? `${title} | ${baseTitle}` : baseTitle;
      document.title = fullTitle;
    }
  }, [title]);
}

export function useSEO({
  title = 'Homiio - Ethical Housing Platform',
  description = 'Find your ethical home with transparent rentals, fair agreements, and verified properties. Join Homiio for a better housing experience.',
  keywords = 'housing, rental, property, ethical housing, transparent rentals, verified properties',
  image = '/assets/images/og-image.png',
  url = '',
  type = 'website',
  twitterHandle = '@homiio',
  author = 'Homiio',
  publishedTime,
  modifiedTime,
  section,
  tags = []
}: SEOProps = {}) {
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const baseTitle = 'Homiio';
      const fullTitle = title ? `${title} | ${baseTitle}` : baseTitle;
      const currentUrl = url || window.location.href;
      const imageUrl = image.startsWith('http') ? image : `${window.location.origin}${image}`;
      
      // Set document title
      document.title = fullTitle;
      
      // Enhanced meta tags for better social media support
      const metaTags = [
        // Basic SEO
        { name: 'description', content: description },
        { name: 'keywords', content: keywords },
        { name: 'author', content: author },
        { name: 'robots', content: 'index, follow' },
        { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
        { name: 'theme-color', content: '#4F46E5' },
        { name: 'msapplication-TileColor', content: '#4F46E5' },
        
        // Open Graph (Facebook, LinkedIn, WhatsApp, Telegram)
        { property: 'og:title', content: fullTitle },
        { property: 'og:description', content: description },
        { property: 'og:type', content: type },
        { property: 'og:image', content: imageUrl },
        { property: 'og:url', content: currentUrl },
        { property: 'og:site_name', content: 'Homiio' },
        { property: 'og:locale', content: 'en_US' },
        { property: 'og:image:width', content: '1200' },
        { property: 'og:image:height', content: '630' },
        { property: 'og:image:alt', content: description },
        { property: 'og:image:type', content: 'image/png' },
        
        // Twitter Card (Enhanced)
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: fullTitle },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: imageUrl },
        { name: 'twitter:image:alt', content: description },
        { name: 'twitter:site', content: twitterHandle },
        { name: 'twitter:creator', content: twitterHandle },
        
        // LinkedIn specific
        { property: 'og:image:secure_url', content: imageUrl },
        
        // Article specific (if type is article)
        ...(type === 'article' && publishedTime ? [{ property: 'article:published_time', content: publishedTime }] : []),
        ...(type === 'article' && modifiedTime ? [{ property: 'article:modified_time', content: modifiedTime }] : []),
        ...(type === 'article' && author ? [{ property: 'article:author', content: author }] : []),
        ...(type === 'article' && section ? [{ property: 'article:section', content: section }] : []),
        ...(type === 'article' && tags.length > 0 ? tags.map(tag => ({ property: 'article:tag', content: tag })) : []),
        
        // WhatsApp specific
        { property: 'og:image:width', content: '300' },
        { property: 'og:image:height', content: '300' },
        
        // Telegram specific
        { property: 'og:image:type', content: 'image/png' },
        
        // Additional social networks
        { name: 'pinterest-rich-pin', content: 'true' },
        
        // Schema.org structured data for better search
        { name: 'application-name', content: 'Homiio' },
        { name: 'apple-mobile-web-app-title', content: 'Homiio' },
        { name: 'apple-mobile-web-app-capable', content: 'yes' },
        { name: 'apple-mobile-web-app-status-bar-style', content: 'default' },
        { name: 'format-detection', content: 'telephone=no' },
        
        // Additional meta for better sharing
        { name: 'msapplication-config', content: '/browserconfig.xml' },
        { name: 'msapplication-TileImage', content: '/assets/images/icon-144x144.png' },
      ];
      
      // Update or create meta tags
      metaTags.forEach(({ name, property, content }) => {
        if (!name && !property) return; // Skip if neither name nor property is provided
        
        const selector = property ? `meta[property="${property}"]` : `meta[name="${name}"]`;
        let meta = document.querySelector(selector) as HTMLMetaElement;
        
        if (!meta) {
          meta = document.createElement('meta');
          if (property) {
            meta.setAttribute('property', property);
          } else if (name) {
            meta.setAttribute('name', name);
          }
          document.head.appendChild(meta);
        }
        
        meta.setAttribute('content', content || '');
      });
      
      // Set canonical URL
      let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
      if (!canonical) {
        canonical = document.createElement('link');
        canonical.setAttribute('rel', 'canonical');
        document.head.appendChild(canonical);
      }
      canonical.setAttribute('href', currentUrl);
      
      // Add JSON-LD structured data for better search engine understanding
      const structuredData = {
        '@context': 'https://schema.org',
        '@type': type === 'article' ? 'Article' : 'WebPage',
        name: fullTitle,
        description: description,
        url: currentUrl,
        image: imageUrl,
        publisher: {
          '@type': 'Organization',
          name: 'Homiio',
          url: 'https://homiio.com'
        },
        ...(type === 'article' && {
          author: {
            '@type': 'Person',
            name: author
          },
          datePublished: publishedTime,
          dateModified: modifiedTime,
          articleSection: section,
          keywords: tags.join(', ')
        })
      };
      
      // Remove existing JSON-LD script
      const existingScript = document.querySelector('script[type="application/ld+json"]');
      if (existingScript) {
        existingScript.remove();
      }
      
      // Add new JSON-LD script
      const script = document.createElement('script');
      script.type = 'application/ld+json';
      script.textContent = JSON.stringify(structuredData);
      document.head.appendChild(script);
    }
  }, [title, description, keywords, image, url, type, twitterHandle, author, publishedTime, modifiedTime, section, tags]);
} 