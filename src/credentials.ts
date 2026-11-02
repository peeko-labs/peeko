import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const dir = join(homedir(), ".peeko")
const credsPath = join(dir, "credentials.json")
const pendingPath = join(dir, "pending.json")

export function peekoUrl() {
  return process.env.PEEKO_URL ?? "https://peeko.sh"
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T
  } catch {
    return null
  }
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(path, JSON.stringify(value, null, 2) + "\n", { mode: 0o600 })
}

// One key per Peeko host, so a local build and the real one never share one.
export function apiKey(): string | null {
  if (process.env.PEEKO_API_KEY) return process.env.PEEKO_API_KEY
  return readJson<Record<string, string>>(credsPath)?.[peekoUrl()] ?? null
}

export function saveApiKey(key: string) {
  writeJson(credsPath, { ...(readJson<Record<string, string>>(credsPath) ?? {}), [peekoUrl()]: key })
}

type Pending = { code: string; url: string; expires: number }

export function pending(): Pending | null {
  const p = readJson<Pending>(pendingPath)
  return p && p.expires > Date.now() ? p : null
}

export function savePending(p: Pending) {
  writeJson(pendingPath, p)
}

export function clearPending() {
  if (existsSync(pendingPath)) unlinkSync(pendingPath)
}

// First call hands back a link to open; once approved on the app, the next call collects the key.
export async function authorize(): Promise<{ ok: true; org: string } | { ok: false; url: string; fresh: boolean }> {
  const p = pending()
  if (p) {
    const res = await fetch(new URL(`/api/connect/${p.code}`, peekoUrl()))
    if (res.status === 202) return { ok: false, url: p.url, fresh: false }
    if (res.ok) {
      const body = (await res.json()) as { key: string; org: string }
      saveApiKey(body.key)
      clearPending()
      return { ok: true, org: body.org }
    }
  }
  const res = await fetch(new URL("/api/connect", peekoUrl()), { method: "POST" })
  if (!res.ok) throw new Error(`Peeko did not answer (${res.status}). Is ${peekoUrl()} reachable?`)
  const body = (await res.json()) as { code: string; url: string }
  savePending({ code: body.code, url: body.url, expires: Date.now() + 9 * 60 * 1000 })
  return { ok: false, url: body.url, fresh: true }
}
