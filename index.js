const version = "0.0.3"

let allowedDomains = process?.env?.ALLOWED_REMOTE_DOMAINS?.split(",") || ["*"];
let imgproxyUrl = process?.env?.IMGPROXY_URL || "http://imgproxy:8080";
const imgproxySignature = process?.env?.IMGPROXY_SIGNATURE || "unsafe";
const imgproxyPreset = process?.env?.IMGPROXY_PRESET;
const maxWidth = Number(process?.env?.MAX_IMAGE_WIDTH || 2048);
const maxHeight = Number(process?.env?.MAX_IMAGE_HEIGHT || 2048);
const supabasePublicStorageBase = process?.env?.SUPABASE_PUBLIC_STORAGE_BASE?.replace(/\/+$/, "");
const dimensionPresets = [320, 480, 640, 720, 960, 1280, 1600, 2048];
const qualityPresets = [50, 75, 85];
const allowedFormats = ["avif", "webp", "jpg"];
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
        if (url.pathname.startsWith("/image/")) return await resize(url, req, url.pathname.split("/").slice(2).join("/"));
        if (url.pathname.startsWith("/i/profile/")) {
            if (!supabasePublicStorageBase) {
                return new Response("SUPABASE_PUBLIC_STORAGE_BASE is not configured", {
                    status: 500,
                    headers: {
                        "Cache-Control": "no-store",
                        "Content-Type": "text/plain",
                    },
                });
            }
            const profilePath = url.pathname.slice("/i/profile/".length);
            return await resize(url, req, `${supabasePublicStorageBase}/images-derived/profile/${profilePath}`);
        }
        return Response.redirect("https://github.com/coollabsio/next-image-transformation", 302);
    }
});

async function resize(url, req, src) {
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
    const requestedWidth = parseDimension(url.searchParams.get("width") || url.searchParams.get("w"), maxWidth);
    const requestedHeight = parseDimension(url.searchParams.get("height") || url.searchParams.get("h"), maxHeight);
    const requestedQuality = parseDimension(url.searchParams.get("quality") || url.searchParams.get("q") || 75, 100);
    const format = url.searchParams.get("f");
    if (requestedWidth === null || requestedHeight === null || requestedQuality === null) {
        return new Response(`Invalid image dimensions. Width and height must be whole numbers between 0 and ${Math.max(maxWidth, maxHeight)}.`, {
            status: 400,
            headers: {
                "Cache-Control": "no-store",
                "Content-Type": "text/plain",
            },
        });
    }
    if (!format) {
        const redirectUrl = new URL(url);
        redirectUrl.searchParams.set("f", chooseFormat(req.headers.get("Accept")));
        redirectUrl.protocol = `${req.headers.get("x-forwarded-proto") || redirectUrl.protocol.replace(":", "")}:`;
        return Response.redirect(redirectUrl.toString(), 302);
    }
    if (!allowedFormats.includes(format)) {
        return new Response(`Invalid image format. Format must be one of: ${allowedFormats.join(", ")}.`, {
            status: 400,
            headers: {
                "Cache-Control": "no-store",
                "Content-Type": "text/plain",
            },
        });
    }
    const width = snapToPreset(requestedWidth, dimensionPresets);
    const height = snapToPreset(requestedHeight, dimensionPresets);
    const quality = snapToPreset(requestedQuality, qualityPresets);
    try {
        const presets = [
            imgproxyPreset || null,
            width ? `w_${width}` : null,
            height ? `h_${height}` : null,
            `q_${quality}`,
            `f_${format}`,
        ].filter(Boolean).join(":");
        const imgproxyRequestUrl = `${imgproxyUrl}/${imgproxySignature}/${presets}/plain/${encodeURI(src)}`
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

function snapToPreset(value, presets) {
    if (value === 0) return 0;
    return presets.find(preset => preset >= value) || presets[presets.length - 1];
}

function chooseFormat(accept) {
    if (accept?.includes("image/avif")) return "avif";
    if (accept?.includes("image/webp")) return "webp";
    return "jpg";
}
