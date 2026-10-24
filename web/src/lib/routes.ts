import type { RouteLock } from '../types'

/** A wrong answer: the sealed routes didn't open. */
export class WrongAnswer extends Error {}

/** Same rule as the exporter: surrounding spaces and case don't count. */
const normalize = (s: string) => s.trim().toLowerCase()

// one download per file, however many answers are tried
const blobs = new Map<string, Promise<Uint8Array>>()
function fetchBlob(file: string): Promise<Uint8Array> {
  let p = blobs.get(file)
  if (!p) {
    p = fetch(import.meta.env.BASE_URL + file)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`${r.status} ${r.statusText}`))))
      .then((b) => new Uint8Array(b))
    p.catch(() => blobs.delete(file))
    blobs.set(file, p)
  }
  return p
}

/**
 * Opens the sealed routes (id -> polyline) with the answer. Layout and key
 * derivation match internal/export/routes.go: salt (16) | nonce (12) |
 * AES-256-GCM(gzip(JSON)), key = PBKDF2-SHA256(answer, salt, iter).
 */
export async function openRoutes(lock: RouteLock, answer: string): Promise<Record<string, string>> {
  const blob = await fetchBlob(lock.file)
  const subtle = crypto.subtle
  const base = await subtle.importKey('raw', new TextEncoder().encode(normalize(answer)), 'PBKDF2', false, ['deriveKey'])
  const key = await subtle.deriveKey(
    { name: 'PBKDF2', salt: blob.slice(0, 16), iterations: lock.iter, hash: 'SHA-256' },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['decrypt'],
  )
  let plain: ArrayBuffer
  try {
    plain = await subtle.decrypt({ name: 'AES-GCM', iv: blob.slice(16, 28) }, key, blob.slice(28))
  } catch {
    throw new WrongAnswer()
  }
  const json = await new Response(new Blob([plain]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
  return JSON.parse(json)
}
