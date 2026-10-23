#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { validateDraft } from "@peeko/protocol"
import { z } from "zod"
import { loadMapping, saveMapping, validateMapping } from "./mapping.js"
import { maskDraft } from "./mask.js"
import { SHAPE, playbook, setup } from "./playbook.js"
import { publishCase } from "./publish.js"

const INSTRUCTIONS = `Peeko builds the case page an app sends its payment processor about one customer: identifiers, accounts and transactions, identity, timeline, action audit, devices and network, with every name, email, phone, card and account number masked before anything leaves the machine.
Peeko is in the room whenever the conversation is about a customer and risk: a hold, a block, a restriction, a dispute, a chargeback, fraud, a mule, or a processor asking questions about someone. Do not wait to be asked for "a Peeko case". When it comes up, call start_case with whatever identifies the customer.
If start_case says Peeko is not set up, tell the user in one line ("your Peeko isn't set up yet, doing it now") and set it up inside what they were doing: say what you can already see connected, ask only for what you cannot see, say that nothing with a name, email, phone, card or account number is ever written, look through their tables yourself, call save_mapping, and tell them in plain words what was saved.
Once set up: read everything, give the shape in two lines, ask for their take, what the customer did, and what they are assuming. Draft once. Publish when they say so, or without asking when they said to just do it. Never put a name, email, phone, card or account number in a draft; hand those values to publish_case in mask.`

const server = new McpServer({ name: "peeko", version: "0.0.1" }, { instructions: INSTRUCTIONS })

const say = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], isError })

server.registerTool(
  "start_case",
  {
    title: "Start a Peeko case",
    description: "The entry point. Call it the moment a customer and risk come up (a hold, a block, a dispute, fraud, a processor asking). Returns the playbook for that customer, or how to set Peeko up if it is not yet.",
    inputSchema: { ref: z.string().optional().describe("What the user gave: the processor's customer id, the app's user id, an email or a phone number.") },
  },
  async ({ ref }) => {
    const m = loadMapping()
    return m.ok ? say(playbook(m.mapping, ref)) : say(setup(m.path, m.errors), true)
  },
)

server.registerTool(
  "save_mapping",
  {
    title: "Save Peeko's setup",
    description: "Writes peeko.yaml, the one-time map of where this app keeps each kind of data. Validates it first. Call it during setup, and again whenever the user corrects where something lives.",
    inputSchema: { mapping: z.record(z.unknown()).describe("The mapping as one JSON object, in the shape start_case gave during setup.") },
  },
  async ({ mapping }) => {
    const v = validateMapping(mapping)
    if (!v.ok) return say(`Not saved. Fix each line and call save_mapping again:\n- ${v.errors.join("\n- ")}`, true)
    const path = saveMapping(v.mapping)
    const m = v.mapping
    return say(
      `Saved to ${path}: ${m.app}, cases go to ${m.processor}, ${m.reviewer} answers them. Sources: ${Object.keys(m.sources).join(", ")}. ${m.queries.length} queries, ${m.mask.length} masked columns. Tell the user in plain words what was saved and ask if that is where their data lives; then call start_case.`,
    )
  },
)

server.registerTool(
  "check_case",
  {
    title: "Check a case draft",
    description: `Validates a draft against the Peeko case shape and refuses anything that looks like raw PII. Nothing is sent. ${SHAPE}`,
    inputSchema: { draft: z.record(z.unknown()).describe("The case draft, as one JSON object.") },
  },
  async ({ draft }) => {
    const r = validateDraft(draft)
    if (!r.ok) return say(`Not valid yet. Fix each line and call check_case again:\n- ${r.errors.join("\n- ")}`, true)
    const d = r.draft
    const hints = [
      d.audit.length === 0 && "audit is empty: the page shows everything recorded; add the screens, messages, webhooks, app actions and sightings.",
      !d.identity && "identity is missing: add account_created_at and what is known.",
      !d.access?.length && "access is empty: add one block per device and IP pair seen.",
    ].filter(Boolean)
    return say(
      `Valid: ${d.facts.length} facts, ${d.events.length} events, ${d.audit.length} audit entries, ${d.records.length} records, ${d.related.length} related, ${d.access?.length ?? 0} access blocks.${hints.length ? `\nBefore publishing:\n- ${hints.join("\n- ")}` : "\nCall publish_case with this draft and the mask."}`,
    )
  },
)

server.registerTool(
  "publish_case",
  {
    title: "Publish a Peeko case",
    description: "Masks the listed values, validates the draft, publishes it to Peeko and returns the link. The only call that sends anything.",
    inputSchema: {
      draft: z.record(z.unknown()).describe("The case draft that passed check_case."),
      mask: z.record(z.string()).default({}).describe('Values that must not appear, each with what to say instead: {"Jane Doe": "the customer", "jane@example.com": "the customer\'s email"}.'),
    },
  },
  async ({ draft, mask }) => {
    const masked = maskDraft(draft, mask)
    const r = validateDraft(masked.draft)
    if (!r.ok) return say(`Refused, nothing was sent. After masking, the draft still has:\n- ${r.errors.join("\n- ")}\nFix the draft or add the value to mask, then call publish_case again.`, true)
    try {
      const { url } = await publishCase(r.draft)
      return say(`Published, ${masked.replaced} values masked. Reply to the user with this link and nothing else:\n${url}`)
    } catch (e) {
      return say((e as Error).message, true)
    }
  },
)

server.registerPrompt(
  "case",
  {
    title: "Peeko case",
    description: "Build the case page for one customer and get the link.",
    argsSchema: { ref: z.string().describe("The processor's customer id, the app's user id, an email or a phone number.") },
  },
  ({ ref }) => ({
    messages: [{ role: "user", content: { type: "text", text: `Peeko case for ${ref}: call start_case with ref "${ref}", read everything, then talk with me before you write.` } }],
  }),
)

await server.connect(new StdioServerTransport())
