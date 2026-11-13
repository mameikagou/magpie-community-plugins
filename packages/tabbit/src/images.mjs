// Images in a turn.
//
// A Tabbit turn is one `content` string plus `references`: the web app sends
// a picture by uploading it (see api.mjs uploadImage) and listing it as an
// `image` reference of the turn. So an image part of a message becomes a
// marker in the text — `[image img-<key>]`, where it sat — and the turn that
// carries the marker carries that image as a reference too. The key is a hash
// of the image itself, so the same picture keeps its marker (the transcript
// the room was sent still matches) and is uploaded once.

import { createHash } from "node:crypto"

export const MARK = /\[image (img-[A-Za-z0-9_-]{10})\]/g

// At most this many images go with one turn: the latest ones its text
// mentions. A fresh room that is sent a long transcript doesn't re-upload
// every picture of it. TABBIT_IMAGES (0..20) changes it; 0 sends none.
export function imageLimitOf(env = process.env) {
  const n = Number.parseInt(env?.TABBIT_IMAGES ?? "", 10)
  return Number.isFinite(n) && n >= 0 && n <= 20 ? n : 8
}

const TYPES = { png: "image/png", jpeg: "image/jpeg", jpg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" }

// sourceOf reads where an image part's picture is, across the shapes callers
// send: OpenAI chat `{type:"image_url", image_url:{url}}` (or a bare string),
// the Responses API's `{type:"input_image", image_url}`, and the AI SDK's
// `{type:"image", image, mediaType|mimeType}` with base64 or a URL.
export function sourceOf(part) {
  if (!part || typeof part !== "object") return null
  const raw = part.image_url?.url ?? part.image_url ?? part.url ?? part.image ?? part.data ?? null
  if (typeof raw !== "string" || !raw.trim()) return null
  const value = raw.trim()
  if (/^(data:|https?:)/i.test(value)) return value
  // Bare base64 (the AI SDK's shape): wrap it with its media type.
  const mime = part.mediaType ?? part.mimeType ?? part.mime_type ?? "image/png"
  return `data:${mime};base64,${value}`
}

export function keyOf(source) {
  return `img-${createHash("sha256").update(source).digest("base64url").slice(0, 10)}`
}

// collector returns the callback partText takes for an image part, recording
// each image's source under its key in `images`.
export function collector(images) {
  return (part) => {
    const source = sourceOf(part)
    if (!source) return null
    const key = keyOf(source)
    if (!images.has(key)) images.set(key, source)
    return `[image ${key}]`
  }
}

// marked lists the image keys a text mentions, latest last, each once.
export function marked(text) {
  const seen = new Set()
  const out = []
  for (const m of String(text ?? "").matchAll(MARK)) {
    if (seen.has(m[1])) continue
    seen.add(m[1])
    out.push(m[1])
  }
  return out
}

// bytesOf turns a source into the bytes to upload: a data: URL is decoded, a
// web URL fetched.
export async function bytesOf(source, { signal, fetchImpl = fetch } = {}) {
  const data = source.match(/^data:([^;,]+)?((?:;[^;,]*)*?),(.*)$/is)
  if (data) {
    const mime = (data[1] || "image/png").toLowerCase()
    const b64 = /;base64/i.test(data[2] || "")
    const bytes = b64 ? Buffer.from(data[3], "base64") : Buffer.from(decodeURIComponent(data[3]), "utf8")
    return { bytes: new Uint8Array(bytes), mime }
  }
  const res = await fetchImpl(source, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(60_000)]) : AbortSignal.timeout(60_000) })
  if (!res.ok) throw new Error(`fetching the image failed (HTTP ${res.status})`)
  const mime = (res.headers.get("content-type") || "").split(";")[0].trim().toLowerCase() || mimeOfName(source)
  return { bytes: new Uint8Array(await res.arrayBuffer()), mime }
}

function mimeOfName(name) {
  const ext = String(name).split(/[?#]/)[0].split(".").pop()?.toLowerCase()
  return TYPES[ext] ?? "image/png"
}

export function nameOf(key, mime) {
  const ext = Object.entries(TYPES).find(([, t]) => t === mime)?.[0] ?? "png"
  return `${key}.${ext === "jpeg" ? "jpg" : ext}`
}

// An upload's download URL lasts 20 days (the web app asks for 1,728,000 s);
// a reference is reused for a little less than that, then uploaded again.
export const REF_TTL = 19 * 24 * 60 * 60 * 1000
export const REF_LIMIT = 256

export function pruneRefs(cache, now = Date.now()) {
  for (const [key, entry] of cache) if (now - entry.at > REF_TTL) cache.delete(key)
  while (cache.size > REF_LIMIT) cache.delete(cache.keys().next().value)
}
