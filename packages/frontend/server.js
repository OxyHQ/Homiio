const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Serve static files
app.use(express.static(path.join(__dirname, 'web-build')));

// Function to generate meta tags for properties
function generatePropertyMetaTags(propertyId) {
  // This would typically fetch from your API
  // For now, we'll generate generic meta tags
  const title = `Property ${propertyId} | Homiio`;
  const description = `Beautiful rental property available on Homiio - your ethical housing platform. Find transparent rentals, fair agreements, and verified properties.`;
  const image = 'https://homiio.com/assets/images/og-image.png';
  const url = `https://homiio.com/properties/${propertyId}`;

  return `
    <meta name="description" content="${description}" />
    <meta name="keywords" content="housing, rental, property, ethical housing, transparent rentals, verified properties" />
    <meta name="author" content="Homiio" />
    <meta name="robots" content="index, follow" />
    
    <!-- Open Graph (Facebook, LinkedIn, WhatsApp, Telegram) -->
    <meta property="og:title" content="${title}" />
    <meta property="og:description" content="${description}" />
    <meta property="og:type" content="website" />
    <meta property="og:image" content="${image}" />
    <meta property="og:url" content="${url}" />
    <meta property="og:site_name" content="Homiio" />
    <meta property="og:locale" content="en_US" />
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${description}" />
    <meta property="og:image:type" content="image/png" />
    <meta property="og:image:secure_url" content="${image}" />
    
    <!-- Twitter Card -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title}" />
    <meta name="twitter:description" content="${description}" />
    <meta name="twitter:image" content="${image}" />
    <meta name="twitter:image:alt" content="${description}" />
    <meta name="twitter:site" content="@homiio" />
    <meta name="twitter:creator" content="@homiio" />
    
    <!-- Additional social networks -->
    <meta name="pinterest-rich-pin" content="true" />
    
    <!-- Schema.org structured data -->
    <script type="application/ld+json">
    {
        "@context": "https://schema.org",
        "@type": "Product",
        "name": "${title}",
        "description": "${description}",
        "url": "${url}",
        "image": "${image}",
        "category": "Real Estate",
        "brand": {
            "@type": "Brand",
            "name": "Homiio"
        },
        "publisher": {
            "@type": "Organization",
            "name": "Homiio",
            "url": "https://homiio.com"
        }
    }
    </script>
  `;
}

// Handle property routes
app.get('/properties/:id', (req, res) => {
  const propertyId = req.params.id;
  
  // Read the base HTML file
  const indexPath = path.join(__dirname, 'web-build', 'index.html');
  
  if (!fs.existsSync(indexPath)) {
    return res.status(404).send('Build not found. Run "npm run build" first.');
  }
  
  let html = fs.readFileSync(indexPath, 'utf8');
  
  // Generate meta tags for this property
  const metaTags = generatePropertyMetaTags(propertyId);
  
  // Replace the title
  html = html.replace(
    '<title>Homiio - Ethical Housing Platform</title>',
    `<title>Property ${propertyId} | Homiio</title>`
  );
  
  // Insert meta tags before the closing head tag
  html = html.replace(
    '</head>',
    `    ${metaTags}\n  </head>`
  );
  
  res.send(html);
});

// Handle all other routes (SPA fallback)
app.get('*', (req, res) => {
  const indexPath = path.join(__dirname, 'web-build', 'index.html');
  
  if (!fs.existsSync(indexPath)) {
    return res.status(404).send('Build not found. Run "npm run build" first.');
  }
  
  res.sendFile(indexPath);
});

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Property pages will have proper meta tags for social media sharing`);
}); 