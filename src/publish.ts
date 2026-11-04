import { apiKey, peekoUrl } from "./credentials.js"

async function post(path: string, payload: unknown) {
  const key = apiKey()
  if (!key) throw new Error("This terminal is not authorized with Peeko yet. Call start_case first.")
  const res = await fetch(new URL(path, peekoUrl()), {
    method: "POST",
    // PEEKO_BYPASS is Vercel's automation bypass, needed only while the host sits behind Vercel's login wall.
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(process.env.PEEKO_BYPASS ? { "x-vercel-protection-bypass": process.env.PEEKO_BYPASS } : {}) },
    body: JSON.stringify(payload),
  })
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null
  return { res, body }
}

export async function publishCase(draft: unknown, shareWith: string[]): Promise<{ id: string; url: string; granted: string[] }> {
  const { res, body } = await post("/api/cases", { draft, share_with: shareWith })
  if (!res.ok || typeof body?.url !== "string" || typeof body.id !== "string") {
    const errors = Array.isArray(body?.errors) ? "\n- " + body.errors.join("\n- ") : ""
    throw new Error(`Peeko refused the case (${res.status}): ${body?.error ?? "no body"}${errors}`)
  }
  return { id: body.id, url: body.url, granted: (body.granted as string[]) ?? [] }
}

export async function grantAccess(caseId: string, emails: string[]): Promise<string[]> {
  const { res, body } = await post(`/api/cases/${caseId}/access`, { emails })
  if (!res.ok || !Array.isArray(body?.granted)) throw new Error(`Peeko refused the grant (${res.status}): ${body?.error ?? "no body"}`)
  return body.granted as string[]
}

// The app user ids that already have a case in this org.
export async function coveredUsers(): Promise<Set<string>> {
  const key = apiKey()
  if (!key) throw new Error("This terminal is not authorized with Peeko yet. Call start_case first.")
  const res = await fetch(new URL("/api/cases", peekoUrl()), { headers: { authorization: `Bearer ${key}` } })
  const body = (await res.json().catch(() => null)) as { cases?: { user_ids?: string[] }[] } | null
  if (!res.ok || !Array.isArray(body?.cases)) throw new Error(`Peeko could not list cases (${res.status}).`)
  return new Set(body.cases.flatMap((c) => c.user_ids ?? []))
}
