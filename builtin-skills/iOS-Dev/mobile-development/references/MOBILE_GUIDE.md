# Mobile Development Guide for Cloudflare

## PWA on Cloudflare Pages

```json
// manifest.json
{
  "name": "My PWA",
  "short_name": "PWA",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#ffffff",
  "theme_color": "#f38020",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

## Service Worker with Cloudflare

```typescript
// sw.ts - Offline-first strategy
const CACHE_NAME = 'v1';
const OFFLINE_URL = '/offline.html';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll([OFFLINE_URL, '/', '/styles.css']);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    fetch(event.request).catch(() => caches.match(OFFLINE_URL))
  );
});
```

## Mobile API with Workers

```typescript
// Optimized for mobile clients
export default {
  async fetch(request: Request, env: Env) {
    const userAgent = request.headers.get('User-Agent') || '';
    const isMobile = /Mobile|Android|iPhone/i.test(userAgent);

    return Response.json({
      data: await getData(env),
      optimized: isMobile ? 'mobile' : 'desktop'
    }, {
      headers: {
        'Cache-Control': isMobile ? 'max-age=300' : 'max-age=3600'
      }
    });
  }
};
```

## Deployment

```bash
# Deploy to Cloudflare Pages
npx wrangler pages deploy dist --project-name=my-pwa
```

---

*Cloudflare Plugin - Mobile Development Skill*
