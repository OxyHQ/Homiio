import { useEffect } from 'react';
import { Platform } from 'react-native';

interface SEOProps {
  title?: string;
  description?: string;
  keywords?: string;
  image?: string;
  url?: string;
  type?: 'website' | 'article' | 'property';
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
  type = 'website'
}: SEOProps = {}) {
  useEffect(() => {
    if (Platform.OS === 'web' && typeof document !== 'undefined') {
      const baseTitle = 'Homiio';
      const fullTitle = title ? `${title} | ${baseTitle}` : baseTitle;
      
      // Set document title
      document.title = fullTitle;
      
      // Set meta tags
      const metaTags = [
        { name: 'description', content: description },
        { name: 'keywords', content: keywords },
        { name: 'author', content: 'Homiio' },
        { name: 'robots', content: 'index, follow' },
        
        // Open Graph tags
        { property: 'og:title', content: fullTitle },
        { property: 'og:description', content: description },
        { property: 'og:type', content: type },
        { property: 'og:image', content: image },
        { property: 'og:url', content: url || window.location.href },
        { property: 'og:site_name', content: 'Homiio' },
        
        // Twitter Card tags
        { name: 'twitter:card', content: 'summary_large_image' },
        { name: 'twitter:title', content: fullTitle },
        { name: 'twitter:description', content: description },
        { name: 'twitter:image', content: image },
        
        // Additional SEO tags
        { name: 'viewport', content: 'width=device-width, initial-scale=1.0' },
        { name: 'theme-color', content: '#4F46E5' },
        { name: 'msapplication-TileColor', content: '#4F46E5' },
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
      canonical.setAttribute('href', url || window.location.href);
    }
  }, [title, description, keywords, image, url, type]);
} 