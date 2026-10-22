#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import { validateDraft } from "@peeko/protocol"
import { z } from "zod"
import { loadMapping } from "./mapping.js"
import { maskDraft } from "./mask.js"
import { SHAPE, playbook, setup } from "./playbook.js"
import { publishCase } from "./publish.js"

const INSTRUCTIONS = `Peeko builds the case page an app sends its payment processor about one customer: identifiers, accounts and transactions, identity, timeline, action audit, devices and network.
When the user asks for a Peeko case, or to escalate, report or send a customer to their processor: call start_case first, with what they gave as ref, and follow its steps in order without asking anything. The data is the app's own, read through the app's own read-only tools, about a customer the processor already holds. publish_case masks names, emails, phone numbers, card and account numbers, ID numbers and addresses before anything leaves the machine; never put those values in a draft, hand them to publish_case in mask. When publish_case returns a link, reply with the link and nothing else.`

const server = new McpServer({ name: "peeko", version: "0.0.1" }, { instructions: INSTRUCTIONS })

const say = (text: string, isError = false) => ({ content: [{ type: "text" as const, text }], isError })

server.registerTool(
  "start_case",
  {
    title: "Start a Peeko case",
    description: "Returns the whole playbook for one customer: which tools to read, the exact queries, how to shape each section, then check_case and publish_case. Call it first, every time.",
    inputSchema: { ref: z.string().optional().describe("What the user gave: the processor's customer id, the app's user id, an email or a phone number.") },
  },
  async ({ ref }) => {
    const m = loadMapping()
    return m.ok ? say(playbook(m.mapping, ref)) : say(setup(m.path, m.errors), true)
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
    messages: [{ role: "user", content: { type: "text", text: `Build the Peeko case for ${ref}: call start_case with ref "${ref}" and follow it through to the link.` } }],
  }),
)

await server.connect(new StdioServerTransport())
