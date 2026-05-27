const version = "0.0.3"

let allowedDomains = process?.env?.ALLOWED_REMOTE_DOMAINS?.split(",") || ["*"];
let imgproxyUrl = process?.env?.IMGPROXY_URL || "http://imgproxy:8080";
const imgproxySignature = process?.env?.IMGPROXY_SIGNATURE || "unsafe";
const imgproxyPreset = process?.env?.IMGPROXY_PRESET;
const maxWidth = Number(process?.env?.MAX_IMAGE_WIDTH || 2048);
const maxHeight = Number(process?.env?.MAX_IMAGE_HEIGHT || 2048);
if (process.env.NODE_ENV === "development") {
    imgproxyUrl = "http://localhost:8888"
}
allowedDomains = allowedDomains.map(d => d.trim());
imgproxyUrl = imgproxyUrl.replace(/\/+$/, "");

Bun.serve({
    port: 3000,
    async fetch(req) {
        const url = new URL(req.url);
        if (url.pathname === "/") {
            return new Response(`<h3>Next Image Transformation v${version}</h3>More info <a href="https://github.com/coollabsio/next-image-transformation">https://github.com/coollabsio/next-image-transformation</a>.`, {
                headers: {
                    "Content-Type": "text/html",
                },
            });
        }

        if (url.pathname === "/health") {
            return new Response("OK");
        };
        if (url.pathname.startsWith("/image/")) return await resize(url, req);
        return Response.redirect("https://github.com/coollabsio/next-image-transformation", 302);
    }
});

async function resize(url, req) {
    const src = url.pathname.split("/").slice(2).join("/");
    const origin = new URL(src).hostname;
    const allowed = allowedDomains.filter(domain => {
        if (domain === "*") return true;
        if (domain === origin) return true;
        if (domain.startsWith("*.") && origin.endsWith(domain.split("*.").pop())) return true;
        return false;
    })
    if (allowed.length === 0) {
        return new Response(`Domain (${origin}) not allowed. More details here: https://github.com/coollabsio/next-image-transformation`, { status: 403 });
    }
    const width = parseDimension(url.searchParams.get("width"), maxWidth);
    const height = parseDimension(url.searchParams.get("height"), maxHeight);
    if (width === null || height === null) {
        return new Response(`Invalid image dimensions. Width and height must be whole numbers between 0 and ${Math.max(maxWidth, maxHeight)}.`, {
            status: 400,
            headers: {
                "Cache-Control": "no-store",
                "Content-Type": "text/plain",
            },
        });
    }
    const quality = url.searchParams.get("quality") || 75;
    try {
        const processingOptions = [
            imgproxyPreset ? `pr:${imgproxyPreset}` : null,
            `resize:fill:${width}:${height}`,
            `q:${quality}`,
        ].filter(Boolean).join("/");
        const imgproxyRequestUrl = `${imgproxyUrl}/${imgproxySignature}/${processingOptions}/plain/${encodeURI(src)}`
        const image = await fetch(imgproxyRequestUrl, {
            headers: {
                "Accept": req.headers.get("Accept") || "*/*",
            }
        })
        const headers = new Headers(image.headers);
        headers.set("Server", "NextImageTransformation");
        if (!image.ok) {
            headers.set("Cache-Control", "no-store");
        }
        return new Response(image.body, {
            status: image.status,
            headers
        })
    } catch (e) {
        console.log(e)
        return new Response("Error resizing image", {
            status: 500,
            headers: {
                "Cache-Control": "no-store",
                "Content-Type": "text/plain",
            },
        })
    }
}

function parseDimension(value, max) {
    if (!value) return 0;
    if (!/^\d+$/.test(value)) return null;
    const dimension = Number(value);
    if (!Number.isSafeInteger(dimension) || dimension > max) return null;
    return dimension;
}
