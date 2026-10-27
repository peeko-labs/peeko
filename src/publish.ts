export async function publishCase(draft: unknown): Promise<{ id: string; url: string }> {
  const key = process.env.PEEKO_API_KEY
  if (!key) throw new Error("PEEKO_API_KEY is not set. Install the MCP with the command on your Peeko dashboard.")
  const res = await fetch(new URL("/api/cases", process.env.PEEKO_URL ?? "https://peeko.sh"), {
    method: "POST",
    // PEEKO_BYPASS is Vercel's automation bypass, needed only while the host sits behind Vercel's login wall.
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...(process.env.PEEKO_BYPASS ? { "x-vercel-protection-bypass": process.env.PEEKO_BYPASS } : {}) },
    body: JSON.stringify(draft),
  })
  const body = (await res.json().catch(() => null)) as { id?: string; url?: string; error?: string; errors?: string[] } | null
  if (!res.ok || !body?.url || !body.id) {
    throw new Error(`Peeko refused the case (${res.status}): ${body?.error ?? "no body"}${body?.errors ? "\n- " + body.errors.join("\n- ") : ""}`)
  }
  return { id: body.id, url: body.url }
}
