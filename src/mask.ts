export type Mask = Record<string, string>

function escape(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Longest value first, so "Jane Doe" is replaced before "Jane" can split it.
export function maskDraft<T>(draft: T, mask: Mask): { draft: T; replaced: number } {
  const entries = Object.entries(mask)
    .filter(([value]) => value.trim().length >= 2)
    .sort((a, b) => b[0].length - a[0].length)
    .map(([value, as]) => [new RegExp(escape(value.trim()), "gi"), as] as const)
  let replaced = 0
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") {
      let s = v
      for (const [re, as] of entries) {
        s = s.replace(re, () => {
          replaced++
          return as
        })
      }
      return s
    }
    if (Array.isArray(v)) return v.map(walk)
    if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]))
    return v
  }
  return { draft: walk(draft) as T, replaced }
}
