# Next Image Transformation

A small self-hosted image optimization service for Next.js applications.

The service has two parts:

1. A Bun API wrapper that exposes short, application-friendly image URLs.
2. An imgproxy container that performs resizing, format conversion, and image processing.

The current deployment is designed for private Supabase Storage originals, imgproxy resizing, and Cloudflare CDN caching.

## URL Contract

### Pretty Supabase routes

Use these routes for high-resolution originals stored in the private `images-originals` Supabase bucket:

```text
https://img.cockbro.com/i/profile/<profile-id>/<image-id>/<file>?w=<width>&q=<quality>&f=<format>
https://img.cockbro.com/i/gallery/<path-to-file>?w=<width>&q=<quality>&f=<format>
https://img.cockbro.com/i/chat/<path-to-file>?w=<width>&q=<quality>&f=<format>
```

Example:

```text
https://img.cockbro.com/i/profile/2b2b8fea-7296-4d79-8525-edde5e6dc3b2/690da1ea-7ea9-4daf-813e-fc23087946b1/gallery-720.jpg?w=720&q=75&f=avif
```

This maps internally to:

```text
images-originals/<route>/<path-to-file>
```

The Bun API creates a short-lived Supabase signed URL for that private object and passes it to imgproxy. The browser only sees the stable `/i/...` URL.

### Generic source route

The original generic route is still supported:

```text
https://img.cockbro.com/image/<absolute-source-url>?width=720&quality=75&f=avif
```

Example:

```text
https://img.cockbro.com/image/https://example.com/image.jpg?width=720&quality=75&f=webp
```

## Query Parameters

The pretty route supports short query params:

```text
w = width
h = height
q = quality
f = output format
```

The generic route supports both short and long names:

```text
width or w
height or h
quality or q
f
```

Supported formats:

```text
avif
webp
jpg
```

Invalid formats return `400` and are not cached.

## Format Selection

For Cloudflare Free, do not rely on `Vary: Accept` to cache AVIF/WebP/JPG variants correctly under the same URL. This service makes the format part of the URL with `f=`.

If `f` is omitted, the Bun API chooses the best format from the request `Accept` header and redirects to a format-specific URL:

```text
/i/profile/.../gallery-720.jpg?w=720
```

Redirects to one of:

```text
/i/profile/.../gallery-720.jpg?w=720&f=avif
/i/profile/.../gallery-720.jpg?w=720&f=webp
/i/profile/.../gallery-720.jpg?w=720&f=jpg
```

Selection order:

```text
image/avif -> avif
image/webp -> webp
otherwise  -> jpg
```

Use explicit `f=` URLs in your frontend where possible to avoid the redirect.

## Responsive Images

For the best frontend behavior, use format-specific URLs in a `<picture>` element. This lets the browser choose both the best format and the best size, while Cloudflare caches each URL independently.

```html
<picture>
  <source
    type="image/avif"
    srcset="
      https://img.cockbro.com/i/profile/<profile-id>/<image-id>/gallery-720.jpg?w=320&f=avif 320w,
      https://img.cockbro.com/i/profile/<profile-id>/<image-id>/gallery-720.jpg?w=640&f=avif 640w,
      https://img.cockbro.com/i/profile/<profile-id>/<image-id>/gallery-720.jpg?w=960&f=avif 960w
    "
    sizes="(max-width: 768px) 100vw, 720px"
  />
  <source
    type="image/webp"
    srcset="
      https://img.cockbro.com/i/profile/<profile-id>/<image-id>/gallery-720.jpg?w=320&f=webp 320w,
      https://img.cockbro.com/i/profile/<profile-id>/<image-id>/gallery-720.jpg?w=640&f=webp 640w,
      https://img.cockbro.com/i/profile/<profile-id>/<image-id>/gallery-720.jpg?w=960&f=webp 960w
    "
    sizes="(max-width: 768px) 100vw, 720px"
  />
  <img
    src="https://img.cockbro.com/i/profile/<profile-id>/<image-id>/gallery-720.jpg?w=720&f=jpg"
    srcset="
      https://img.cockbro.com/i/profile/<profile-id>/<image-id>/gallery-720.jpg?w=320&f=jpg 320w,
      https://img.cockbro.com/i/profile/<profile-id>/<image-id>/gallery-720.jpg?w=640&f=jpg 640w,
      https://img.cockbro.com/i/profile/<profile-id>/<image-id>/gallery-720.jpg?w=960&f=jpg 960w
    "
    sizes="(max-width: 768px) 100vw, 720px"
    width="720"
    height="720"
    alt=""
    loading="lazy"
    decoding="async"
  />
</picture>
```

## Using Next.js `Image`

`next/image` with a custom loader can use the pretty URL, but it emits a single URL per generated image candidate. If you omit `f`, the service redirects once to the best format-specific URL.

Example loader:

```js
'use client'

const imageOptimizationApi = 'https://img.cockbro.com';

export default function imageLoader({ src, width, quality }) {
  const query = new URLSearchParams();
  query.set('w', width);
  query.set('q', quality || 75);

  return `${imageOptimizationApi}${src}?${query.toString()}`;
}
```

Example usage:

```tsx
import Image from 'next/image';

<Image
  src="/i/profile/2b2b8fea-7296-4d79-8525-edde5e6dc3b2/690da1ea-7ea9-4daf-813e-fc23087946b1/gallery-720.jpg"
  width={720}
  height={720}
  sizes="(max-width: 768px) 100vw, 720px"
  alt=""
/>
```

For high-traffic or above-the-fold images, prefer a custom `<picture>` wrapper with explicit `f=avif`, `f=webp`, and `f=jpg` URLs. That avoids redirects and is safest with Cloudflare Free.

## Preset Bucketing

The wrapper snaps requested widths and heights to preset buckets before calling imgproxy:

```text
320, 360, 480, 640, 720, 960, 1280, 1600, 2048
```

Examples:

```text
w=713 -> w_720
w=721 -> w_960
w=2049 -> 400
```

Quality is snapped to:

```text
50, 75, 85
```

Examples:

```text
q=60 -> q_75
q=76 -> q_85
q=101 -> 400
```

This reduces the number of unique Cloudflare cache keys and improves cache hit rate.

## Resize Behavior

imgproxy runs in `IMGPROXY_ONLY_PRESETS=true` mode.

The default preset uses:

```text
resizing_type:fit
```

This preserves aspect ratio by default. Width-only URLs resize by width. Height-only URLs resize by height. Width plus height fits inside the requested box rather than cropping.

## Cloudflare Caching

Successful image responses include:

```text
cache-control: max-age=31536000, public
vary: Accept
```

Because Cloudflare Free does not safely vary cached images by `Accept`, use format-specific URLs:

```text
?f=avif
?f=webp
?f=jpg
```

Verified behavior:

```text
?f=avif -> image/avif -> second request cf-cache-status: HIT
?f=webp -> image/webp -> second request cf-cache-status: HIT
?f=jpg  -> image/jpeg -> second request cf-cache-status: HIT
```

Error responses use `Cache-Control: no-store` and should return `cf-cache-status: BYPASS`.

## Environment Variables

Set these in Coolify:

```env
ALLOWED_REMOTE_DOMAINS=your-project.supabase.co
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SECRET_KEY=your-sb-secret-key
SUPABASE_ORIGINALS_BUCKET=images-originals
SUPABASE_SIGNED_URL_EXPIRES_IN=60
MAX_IMAGE_WIDTH=2048
MAX_IMAGE_HEIGHT=2048
```

Use a modern Supabase secret key, formatted like `sb_secret_...`, for `SUPABASE_SECRET_KEY`.

Useful imgproxy defaults:

```env
IMGPROXY_WORKERS=2
IMGPROXY_MAX_RESULT_DIMENSION=2048
IMGPROXY_ALLOWED_SOURCES=https://your-project.supabase.co/
IMGPROXY_MAX_SRC_RESOLUTION=50
IMGPROXY_MAX_SRC_FILE_SIZE=10485760
IMGPROXY_MAX_ANIMATION_FRAMES=1
IMGPROXY_DOWNLOAD_TIMEOUT=5
IMGPROXY_READ_REQUEST_TIMEOUT=10
IMGPROXY_WRITE_RESPONSE_TIMEOUT=10
```

## Architecture

Request flow:

```text
Browser
  -> Cloudflare
  -> Bun API wrapper
  -> imgproxy
  -> Supabase Storage
```

The Bun API is responsible for:

- Pretty `/i/profile/...` routes
- Pretty `/i/gallery/...` routes
- Pretty `/i/chat/...` routes
- Creating short-lived signed URLs for private `images-originals` objects
- Generic `/image/<absolute-url>` routes
- Width, height, quality, and format validation
- Preset bucketing
- `Accept` based redirects when `f` is omitted
- Domain allowlisting before forwarding to imgproxy

imgproxy is responsible for:

- Resizing
- Format conversion
- Source size limits
- Result size limits
- Source allowlisting as a second layer of protection

Cloudflare is responsible for:

- CDN caching by URL
- Serving repeated format-specific image requests from edge cache
