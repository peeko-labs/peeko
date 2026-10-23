import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { parse, stringify } from "yaml"
import { z } from "zod"

// peeko.yaml: where this app keeps each kind of data. Written once per app, read on every case.
const SourceSchema = z.object({
  mcp: z.string().min(1),
  tool: z.string().min(1),
  how: z.string().optional(),
})

const QuerySchema = z.object({
  name: z.string().min(1),
  source: z.string().min(1),
  fills: z.string().min(1),
  run: z.string().min(1),
})

export const MappingSchema = z.object({
  app: z.string().min(1),
  processor: z.string().min(1),
  reviewer: z.string().min(1),
  notes: z.string().optional(),
  sources: z.record(SourceSchema),
  mask: z.array(z.string()).default([]),
  codes: z.record(z.record(z.string())).default({}),
  find: QuerySchema.omit({ name: true, fills: true }),
  queries: z.array(QuerySchema).min(1),
})
export type Mapping = z.infer<typeof MappingSchema>

export function mappingPath() {
  return process.env.PEEKO_MAPPING ?? resolve(process.cwd(), "peeko.yaml")
}

export type LoadedMapping = { ok: true; path: string; mapping: Mapping } | { ok: false; path: string; errors: string[] }

export function validateMapping(doc: unknown): { ok: true; mapping: Mapping } | { ok: false; errors: string[] } {
  const parsed = MappingSchema.safeParse(doc)
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join(".") || "file"}: ${i.message}`) }
  const unknown = [parsed.data.find.source, ...parsed.data.queries.map((q) => q.source)].filter((s) => !parsed.data.sources[s])
  if (unknown.length) return { ok: false, errors: [`queries use sources not listed under sources: ${[...new Set(unknown)].join(", ")}`] }
  return { ok: true, mapping: parsed.data }
}

export function loadMapping(): LoadedMapping {
  const path = mappingPath()
  let raw: string
  try {
    raw = readFileSync(path, "utf8")
  } catch {
    return { ok: false, path, errors: ["missing"] }
  }
  let doc: unknown
  try {
    doc = parse(raw)
  } catch (e) {
    return { ok: false, path, errors: [`not valid YAML: ${(e as Error).message}`] }
  }
  const v = validateMapping(doc)
  return v.ok ? { ok: true, path, mapping: v.mapping } : { ok: false, path, errors: v.errors }
}

export function saveMapping(mapping: Mapping): string {
  const path = mappingPath()
  writeFileSync(path, "# Where this app keeps each kind of data Peeko puts on a case page. Written by Peeko, read on every case.\n" + stringify(mapping))
  return path
}
