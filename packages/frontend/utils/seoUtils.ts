import { Platform } from 'react-native';

interface SEOUpdateOptions {
  title?: string;
  description?: string;
  image?: string;
  url?: string;
  type?: 'website' | 'article' | 'property';
  twitterHandle?: string;
  author?: string;
  publishedTime?: string;
  modifiedTime?: string;
  section?: string;
  tags?: string[];
}

/**
 * Generate static meta tags HTML for server-side rendering
 * This is crucial for social media crawlers like Telegram
 */
export function generateStaticMetaTags(options: SEOUpdateOptions): string {
  const {
    title = 'Homiio - Ethical Housing Platform',
    description = 'Find your ethical home with transparent rentals, fair agreements, and verified properties. Join Homiio for a better housing experience.',
    image = '/assets/images/og-image.png',
    url = 'https://homiio.com',
    type = 'website',
    twitterHandle = '@homiio',
    author = 'Homiio',
    publishedTime,
    modifiedTime,
    section,
    tags = []
  } = options;

  const baseTitle = 'Homiio';
  const fullTitle = title ? `${title} | ${baseTitle}` : baseTitle;
  const imageUrl = image.startsWith('http') ? image : `https://homiio.com${image}`;
  const currentUrl = url.startsWith('http') ? url : `https://homiio.com${url}`;

  const metaTags = [
    // Basic SEO
    `<meta name="description" content="${description}" />`,
    `<meta name="keywords" content="${tags.join(', ')}" />`,
    `<meta name="author" content="${author}" />`,
    `<meta name="robots" content="index, follow" />`,
    
    // Open Graph (Facebook, LinkedIn, WhatsApp, Telegram)
    `<meta property="og:title" content="${fullTitle}" />`,
    `<meta property="og:description" content="${description}" />`,
    `<meta property="og:type" content="${type}" />`,
    `<meta property="og:image" content="${imageUrl}" />`,
    `<meta property="og:url" content="${currentUrl}" />`,
    `<meta property="og:site_name" content="Homiio" />`,
    `<meta property="og:locale" content="en_US" />`,
    `<meta property="og:image:width" content="1200" />`,
    `<meta property="og:image:height" content="630" />`,
    `<meta property="og:image:alt" content="${description}" />`,
    `<meta property="og:image:type" content="image/png" />`,
    `<meta property="og:image:secure_url" content="${imageUrl}" />`,
    
    // Twitter Card
    `<meta name="twitter:card" content="summary_large_image" />`,
    `<meta name="twitter:title" content="${fullTitle}" />`,
    `<meta name="twitter:description" content="${description}" />`,
    `<meta name="twitter:image" content="${imageUrl}" />`,
    `<meta name="twitter:image:alt" content="${description}" />`,
    `<meta name="twitter:site" content="${twitterHandle}" />`,
    `<meta name="twitter:creator" content="${twitterHandle}" />`,
    
    // Additional social networks
    `<meta name="pinterest-rich-pin" content="true" />`,
    
    // Article specific (if type is article)
    ...(type === 'article' && publishedTime ? [`<meta property="article:published_time" content="${publishedTime}" />`] : []),
    ...(type === 'article' && modifiedTime ? [`<meta property="article:modified_time" content="${modifiedTime}" />`] : []),
    ...(type === 'article' && author ? [`<meta property="article:author" content="${author}" />`] : []),
    ...(type === 'article' && section ? [`<meta property="article:section" content="${section}" />`] : []),
    ...(type === 'article' && tags.length > 0 ? tags.map(tag => `<meta property="article:tag" content="${tag}" />`) : []),
  ];

  // Generate structured data
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': type === 'article' ? 'Article' : type === 'property' ? 'Product' : 'WebPage',
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
    }),
    ...(type === 'property' && {
      '@type': 'Product',
      category: 'Real Estate',
      brand: {
        '@type': 'Brand',
        name: 'Homiio'
      }
    })
  };

  const structuredDataScript = `<script type="application/ld+json">${JSON.stringify(structuredData)}</script>`;

  return metaTags.join('\n    ') + '\n    ' + structuredDataScript;
}

/**
 * Update meta tags for social media platforms
 * This function ensures meta tags are properly set for crawlers
 */
export function updateSocialMediaMetaTags(options: SEOUpdateOptions) {
  if (Platform.OS !== 'web' || typeof document === 'undefined') {
    return;
  }

  const {
    title,
    description,
    image,
    url,
    type = 'website',
    twitterHandle = '@homiio',
    author = 'Homiio',
    publishedTime,
    modifiedTime,
    section,
    tags = []
  } = options;

  const baseTitle = 'Homiio';
  const fullTitle = title ? `${title} | ${baseTitle}` : baseTitle;
  const currentUrl = url || window.location.href;
  const imageUrl = image ? (image.startsWith('http') ? image : `${window.location.origin}${image}`) : '/assets/images/og-image.png';

  // Update document title
  document.title = fullTitle;

  // Use global updateMetaTags function if available
  if (typeof window !== 'undefined' && (window as any).updateMetaTags) {
    (window as any).updateMetaTags(fullTitle, description, imageUrl, currentUrl);
  }

  // Update meta tags directly
  const metaUpdates = [
    { selector: 'meta[name="description"]', content: description },
    { selector: 'meta[property="og:title"]', content: fullTitle },
    { selector: 'meta[property="og:description"]', content: description },
    { selector: 'meta[property="og:image"]', content: imageUrl },
    { selector: 'meta[property="og:url"]', content: currentUrl },
    { selector: 'meta[name="twitter:title"]', content: fullTitle },
    { selector: 'meta[name="twitter:description"]', content: description },
    { selector: 'meta[name="twitter:image"]', content: imageUrl },
  ];

  metaUpdates.forEach(({ selector, content }) => {
    if (content) {
      const element = document.querySelector(selector) as HTMLMetaElement;
      if (element) {
        element.setAttribute('content', content);
      }
    }
  });

  // Update canonical URL
  let canonical = document.querySelector('link[rel="canonical"]') as HTMLLinkElement;
  if (!canonical) {
    canonical = document.createElement('link');
    canonical.setAttribute('rel', 'canonical');
    document.head.appendChild(canonical);
  }
  canonical.setAttribute('href', currentUrl);

  // Update structured data
  updateStructuredData({
    title: fullTitle,
    description,
    image: imageUrl,
    url: currentUrl,
    type,
    author,
    publishedTime,
    modifiedTime,
    section,
    tags
  });
}

/**
 * Update JSON-LD structured data
 */
function updateStructuredData(data: {
  title: string;
  description?: string;
  image?: string;
  url: string;
  type: string;
  author?: string;
  publishedTime?: string;
  modifiedTime?: string;
  section?: string;
  tags?: string[];
}) {
  const structuredData = {
    '@context': 'https://schema.org',
    '@type': data.type === 'article' ? 'Article' : data.type === 'property' ? 'Product' : 'WebPage',
    name: data.title,
    description: data.description,
    url: data.url,
    image: data.image,
    publisher: {
      '@type': 'Organization',
      name: 'Homiio',
      url: 'https://homiio.com'
    },
    ...(data.type === 'article' && {
      author: {
        '@type': 'Person',
        name: data.author
      },
      datePublished: data.publishedTime,
      dateModified: data.modifiedTime,
      articleSection: data.section,
      keywords: data.tags?.join(', ')
    }),
    ...(data.type === 'property' && {
      '@type': 'Product',
      category: 'Real Estate',
      brand: {
        '@type': 'Brand',
        name: 'Homiio'
      }
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

/**
 * Generate SEO-friendly title for properties
 */
export function generatePropertyTitle(property: {
  title?: string;
  address?: string;
  city?: string;
  price?: number;
  bedrooms?: number;
  bathrooms?: number;
}) {
  const { title, address, city, price, bedrooms, bathrooms } = property;
  
  if (title) {
    return title;
  }

  const parts = [];
  
  if (bedrooms && bathrooms) {
    parts.push(`${bedrooms} bed, ${bathrooms} bath`);
  } else if (bedrooms) {
    parts.push(`${bedrooms} bedroom`);
  }
  
  if (address) {
    parts.push(address);
  } else if (city) {
    parts.push(city);
  }
  
  if (price) {
    parts.push(`$${price.toLocaleString()}/month`);
  }
  
  return parts.length > 0 ? parts.join(' - ') : 'Property';
}

/**
 * Generate SEO-friendly description for properties
 */
export function generatePropertyDescription(property: {
  description?: string;
  address?: string;
  city?: string;
  price?: number;
  bedrooms?: number;
  bathrooms?: number;
  features?: string[];
}) {
  const { description, address, city, price, bedrooms, bathrooms, features } = property;
  
  if (description) {
    return description;
  }

  const parts = [];
  
  if (bedrooms && bathrooms) {
    parts.push(`${bedrooms} bedroom, ${bathrooms} bathroom`);
  } else if (bedrooms) {
    parts.push(`${bedrooms} bedroom`);
  }
  
  parts.push('rental property');
  
  if (address) {
    parts.push(`in ${address}`);
  } else if (city) {
    parts.push(`in ${city}`);
  }
  
  if (price) {
    parts.push(`for $${price.toLocaleString()}/month`);
  }
  
  if (features && features.length > 0) {
    parts.push(`with ${features.slice(0, 3).join(', ')}`);
  }
  
  parts.push('on Homiio - your ethical housing platform.');
  
  return parts.join(' ');
}

/**
 * Force social media crawlers to re-fetch meta tags
 * This is especially useful for Telegram and other platforms
 */
export function forceMetaTagRefresh() {
  if (Platform.OS !== 'web' || typeof window === 'undefined') {
    return;
  }

  // Add a cache-busting parameter to force re-fetch
  const currentUrl = new URL(window.location.href);
  currentUrl.searchParams.set('_t', Date.now().toString());
  
  // Update URL without page reload
  window.history.replaceState({}, document.title, currentUrl.toString());
  
  // Remove the parameter after a short delay
  setTimeout(() => {
    const cleanUrl = new URL(window.location.href);
    cleanUrl.searchParams.delete('_t');
    window.history.replaceState({}, document.title, cleanUrl.toString());
  }, 100);
} 