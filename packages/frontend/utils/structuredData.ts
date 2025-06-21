export interface PropertyStructuredData {
  name: string;
  description: string;
  image: string;
  address: {
    streetAddress: string;
    addressLocality: string;
    addressRegion: string;
    postalCode: string;
    addressCountry: string;
  };
  price: number;
  priceCurrency: string;
  numberOfRooms: number;
  floorSize: number;
  floorSizeUnit: string;
  propertyType: string;
  availability: 'Available' | 'Rented' | 'Under Contract';
  url: string;
}

export interface OrganizationStructuredData {
  name: string;
  description: string;
  url: string;
  logo: string;
  sameAs: string[];
  contactPoint: {
    '@type': 'ContactPoint';
    telephone: string;
    contactType: string;
  };
}

export function generatePropertyStructuredData(property: PropertyStructuredData) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Apartment',
    name: property.name,
    description: property.description,
    image: property.image,
    address: {
      '@type': 'PostalAddress',
      streetAddress: property.address.streetAddress,
      addressLocality: property.address.addressLocality,
      addressRegion: property.address.addressRegion,
      postalCode: property.address.postalCode,
      addressCountry: property.address.addressCountry,
    },
    offers: {
      '@type': 'Offer',
      price: property.price,
      priceCurrency: property.priceCurrency,
      availability: `https://schema.org/${property.availability}`,
      url: property.url,
    },
    numberOfRooms: property.numberOfRooms,
    floorSize: {
      '@type': 'QuantitativeValue',
      value: property.floorSize,
      unitCode: property.floorSizeUnit,
    },
    additionalProperty: property.propertyType,
  };
}

export function generateOrganizationStructuredData(org: OrganizationStructuredData) {
  return {
    '@context': 'https://schema.org',
    '@type': 'Organization',
    name: org.name,
    description: org.description,
    url: org.url,
    logo: {
      '@type': 'ImageObject',
      url: org.logo,
    },
    sameAs: org.sameAs,
    contactPoint: org.contactPoint,
  };
}

export function generateWebsiteStructuredData() {
  return {
    '@context': 'https://schema.org',
    '@type': 'WebSite',
    name: 'Homiio',
    description: 'Ethical housing platform for transparent rentals and verified properties',
    url: 'https://homiio.com',
    potentialAction: {
      '@type': 'SearchAction',
      target: {
        '@type': 'EntryPoint',
        urlTemplate: 'https://homiio.com/search?q={search_term_string}',
      },
      'query-input': 'required name=search_term_string',
    },
  };
}

export function generateBreadcrumbStructuredData(items: Array<{ name: string; url: string }>) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  };
}

export function injectStructuredData(data: any) {
  if (typeof document !== 'undefined') {
    // Remove existing structured data
    const existingScripts = document.querySelectorAll('script[type="application/ld+json"]');
    existingScripts.forEach(script => script.remove());
    
    // Add new structured data
    const script = document.createElement('script');
    script.type = 'application/ld+json';
    script.textContent = JSON.stringify(data);
    document.head.appendChild(script);
  }
} 