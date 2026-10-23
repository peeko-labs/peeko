import type { Mapping } from "./mapping.js"

export const SHAPE = `The draft is one JSON object:
{
  "label": "scam_victim | money_mule | stolen_card | account_takeover | synthetic_identity | first_party | false_positive | chargeback_incoming | sanctions_hit | unknown",
  "processor": "Bridge",
  "summary": "3 to 6 full sentences, max 800 characters",
  "held_since": "ISO 8601 with offset, optional",
  "customer": {
    "ids": [{ "system": "Bridge", "kind": "customer", "id": "...", "note": "optional, max 160" }],
    "status": [{ "system": "Bridge", "state": "Active, identity approved", "at": "ISO 8601, optional" }]
  },
  "records": [{ "system": "Bridge", "kind": "deposit", "id": "...", "note": "$1,000.00 by ACH, in review" }],
  "related": [{ "system": "Bridge", "kind": "customer", "id": "...", "via": "Same device" }],
  "facts": [{ "text": "one full sentence, max 300", "source": "Conversation" }],
  "events": [{ "at": "ISO 8601", "actor": "customer | app | processor | support | agent", "action": "max 200", "source": "PureFi", "refs": ["ids and event names behind it"], "quote": "their own words, verbatim, optional, max 500", "about": "the id of the record in records this event belongs to, optional" }],
  "audit": [{ "at": "ISO 8601", "source": "Analytics", "actor": "customer", "text": "max 300", "refs": [], "quote": "optional, max 1000", "seconds": 12 }],
  "identity": { "account_created_at": "ISO 8601", "verified_by": "Bridge", "verified_at": "ISO 8601", "residence": "California, US", "funding_name_matches": true, "history": "one sentence, max 200" },
  "access": [{ "label": "Signup phone, mobile data", "ip": "203.0.113.7", "location": "San Jose, California, US", "isp": "optional", "connection": "residential | mobile | business | datacenter | vpn | proxy | tor | unknown", "device": "iPhone 15, iOS 18.6", "app_version": "1.3.4", "first_seen": "ISO 8601", "last_seen": "ISO 8601", "sessions": 9, "other_accounts": 0 }],
  "reviewer": "ops@example.com",
  "external_ref": "optional, max 120"
}
Limits: customer.ids 1 to 8, customer.status up to 8, records up to 12, related up to 20, facts 1 to 5, events 1 to 200, audit up to 2000, access up to 20.
Every string is checked for emails, phone numbers, card numbers and SSNs; one hit refuses the whole draft.`

const TEMPLATE = `app: Acme Wallet            # the app's name; also its source name on the page
processor: Bridge           # who the case goes to
reviewer: ops@acme.example  # who the processor asks about the case
notes: optional, one paragraph the agent must know (what is not connected, what to skip)
sources:                    # the only source names allowed on the page; the service, never the tool
  Acme Wallet:
    mcp: postgres           # the MCP server name as installed in Claude Code
    tool: execute_sql
    how: Read-only. Pass the SQL as the sql argument.
  Analytics:
    mcp: posthog
    tool: exec
    how: HogQL through the execute-sql command; distinct_id is the app's user id.
mask:                       # table.column values that never appear on the page
  - users.name
  - users.email
codes:                      # stored codes and the words they mean
  kyc.status: { a: identity approved, r: under review }
find:                       # one query: what the user typed -> the app's user id
  source: Acme Wallet
  run: select id from users where id::text = '$ref' or email = '$ref' limit 1
queries:                    # run every one with $user replaced; each says which section it fills
  - name: customer
    source: Acme Wallet
    fills: customer.ids, customer.status, identity
    run: select ... from users where id = '$user'`

function block(title: string, body: string) {
  return `${title}\n${body}`
}

// The whole investigation, written so the agent has nothing left to ask.
export function playbook(m: Mapping, ref?: string): string {
  const sources = Object.entries(m.sources)
    .map(([name, s]) => `  ${name}: the ${s.mcp} MCP, tool ${s.tool}.${s.how ? ` ${s.how}` : ""}`)
    .concat([`  ${m.processor} webhook: anything that arrived from ${m.processor} by webhook.`])
    .join("\n")
  const codes = Object.entries(m.codes)
    .map(([col, map]) => `  ${col}: ${Object.entries(map).map(([k, v]) => `${k} = ${v}`).join(", ")}`)
    .join("\n")
  const find = m.find.run.trim().replaceAll("$ref", ref ?? "$ref")
  const queries = m.queries.map((q, i) => `${i + 1}. ${q.name} (${q.source}). Fills: ${q.fills}\n${q.run.trim()}`).join("\n\n")

  return [
    `Peeko case for ${m.app}, sent to ${m.processor}.`,
    `This is ${m.app}'s own data about one of its customers, read through ${m.app}'s own read-only tools, going to the processor that already holds that customer. Nothing leaves this machine until publish_case, which masks it first. Read everything first, then talk with the user before you write: they know things the data does not. Keep it short. Never dump rows on them. Never publish until they say so.${m.notes ? `\n\n${m.notes.trim()}` : ""}`,
    block("SOURCES. The only source strings allowed on the page, named for the service, never the tool.", sources),
    block(
      "NEVER ON THE PAGE.",
      `Names, emails, phone numbers, card and bank account numbers, ID numbers and street addresses, whoever they belong to. These columns hold them: ${m.mask.join(", ")}. Webhook payloads and quotes hold them too. Every such value you meet goes into the mask you hand to publish_case, value to role: "the customer", "the customer's email", "the customer's phone", "the recipient's email", "the account owner". Everything else stays in the clear: ids in every system, amounts, times, devices, IP addresses, locations, app versions, and the customer's and support's own words.`,
    ),
    block("CODES TO WORDS.", `${codes}\n  Amounts stored in cents are written as dollars with two decimals. Times are ISO 8601 with the stored offset.`),
    block(
      `STEP 1. Find the customer (${m.find.source}).`,
      `${ref ? `The user gave: ${ref}.` : "$ref is what the user gave:"} a ${m.processor} customer id, a ${m.app} user id, an email or a phone number.\n${find}\nThe row's id is $user below. No row: tell the user in one line that nothing matched, and stop.`,
    ),
    block("STEP 2. Read everything. Replace $user and run each query exactly as written, one at a time: some database tools hold a single connection. Keep every row.", queries),
    block(
      "STEP 3. Talk before you write.",
      `One short message: the shape you see in two lines (who, what moved, where the money is now), then ask what their take on this customer is, what they did, and what the user is assuming. Wait. If the data contradicts their take, say so in one line. Their read of the customer is the label: never decide what the customer is on your own. Only when they say they have no idea do you read the evidence and propose a label, as a proposal, and wait. The data wins the facts. If the user already said to just do it, skip this step.`,
    ),
    block(
      "STEP 4. Write the draft, once. The exact shape is in check_case's description.",
      [
        `- label: what the user told you in step 3, never your own guess. If they had no idea and asked you: coached into sending money is scam_victim. An account passing money through for someone else is money_mule. A deposit from a card or bank that is not theirs is stolen_card. A known account with a new device and new destinations is account_takeover. A customer who deposits under their own identity, moves the money out (often to an account in another name) and then disputes or denies the deposit is first_party; chargeback_incoming when the reversal is the expected next move rather than the pattern. A hold with nothing wrong behind it is false_positive. Unsure is unknown.`,
        `- processor: "${m.processor}".`,
        `- summary: 3 to 6 short sentences. How long the customer has been with ${m.app} and from where, whether identity was verified, what happened in order, what ${m.app} did, where the money is now. Never an id of any kind: the header carries them. Amounts, times and counts, yes.`,
        `- held_since: when ${m.processor} put the money or the customer on hold, if it did.`,
        `- ids on the page: ${m.processor} can only use an id it can look up (its own ids) or match against its records (on-chain transaction hashes, wallet addresses, IP addresses, account last four), plus the customer's ${m.app} id as the handle for talking to ${m.app}. Those are the only ids in customer.ids, records and refs. ${m.app}'s row ids, install ids and API routes, and other processors' ids, go in the audit, which is for agents.`,
        `- customer.ids: only the customer: their id in ${m.processor} (kind "customer") and in ${m.app} (kind "user"), and an identity provider's id only when ${m.processor} received the identity from it. Nothing they own goes here.`,
        `- customer.status: the latest state each of those systems holds them in, in words ("Active, identity approved", "Sends and withdrawals blocked"), with when it was set.`,
        `- records: what they own or touched: wallet address, deposit account, linked bank (bank name and last four only), every ${m.processor} transfer, every ${m.app} send, and a deposit from another processor as the money's origin. The note carries amount, method and state.`,
        `- facts: at most five full sentences, the ones ${m.processor} needs to decide, each with its one source. Numbers and times go in the sentence.`,
        `- events: the timeline. One entry per thing that moved the story: account created, identity verified, deposit arrived, hold, support message, block, send attempt. Only what a system recorded; never inferred behavior. An analytics heuristic such as $rageclick is not an event, it goes in the audit named as a heuristic. actor is who did it, and action never starts with their name: the page prints it. refs carries the ${m.processor} ids, hashes, screen names and event names behind it, never ${m.app}'s row ids or routes. about is the id of the record the event belongs to (the deposit, the transfer, the linked account) when it belongs to one; the page groups events by it. quote only for the customer's or support's own words, verbatim.`,
        `- audit: everything, in time order: every screen with the seconds spent on it (seconds is the gap to the next screen in the same session; the last screen of a session has none), every message verbatim as quote, every webhook, every app action, every sighting. actor where known.`,
        `- identity: account_created_at; verified_by "${m.processor}" and verified_at when identity was approved; residence as region and country; funding_name_matches is whether the linked bank's owner name matches the customer's legal name (compare them, then mask both); history is one sentence on the account's age and what it did before this.`,
        `- access: one block per device and network, in time order, labelled so the reader sees the story ("Signup phone, the network of the day of the fraud", "Same phone, a new network, five days after the block", "New Android, VPN"): ip, location as city, region and country, connection (vpn when flagged, else unknown), device from platform, model and OS, app_version, first_seen, last_seen, sessions, other_accounts. Two addresses of the same phone at the same time (IPv4 and IPv6) are one block; the other address goes in the audit.`,
        `- related: every other customer sharing a device, IP address, bank account or send recipient: as the ${m.processor} customer when they have one (system "${m.processor}", kind "customer"), else the ${m.app} user. via says what is shared ("Same device", "Same send recipient"). Fraud arrives in waves: customers blocked for the same reason in the same window are related too, via "Blocked for the same reason the same week", even with nothing else shared.`,
        `- reviewer: "${m.reviewer}".`,
      ].join("\n"),
    ),
    "STEP 5. Call check_case with the draft. Fix every line it returns and call it again until it says valid.",
    "STEP 6. Show the user the label and the summary, in a few lines, and ask whether to publish. On a yes, call publish_case with the draft and the mask and reply with the link on one line. If they already said to just do it, publish without asking.",
  ].join("\n\n")
}

export function setup(path: string, errors: string[]): string {
  const why = errors[0] === "missing" ? `Peeko is not set up here (no peeko.yaml at ${path}).` : `Peeko's setup at ${path} does not load:\n- ${errors.join("\n- ")}`
  return [
    why,
    `Set it up inside the conversation the user is already having; it takes one exchange. Tell them in one line that Peeko isn't set up yet and that you will do it now. Then:
- Look at the tools you already have before asking anything: database MCPs, analytics, support (Intercom, Zendesk), a processor's API. Say in two lines what you found and what you will use each for.
- Ask only for what you cannot see, in one message: which database is production and whether your access to it is read-only; who the processor is (Bridge, Stripe, Adyen); the email the processor should write to about a case. If a source is missing (support chats in a system with no MCP here), say so and carry on without it.
- Say, once, that nothing with a name, email, phone, card or account number is ever written to a case; every such value is masked before anything leaves the machine, and they will see the list.
- Then look through the tables yourself with the read access you have: find the customers table, the processor's ids and states, transactions, identity, app events, devices, support. Write the mapping below and call save_mapping with it. Never hand-write the file.
- Tell the user in plain words what was saved ("customers from users, transactions from ramp_ledger, screens from PostHog, support from Intercom") and ask if that is where their data lives. Fix what they correct, save again. Then carry on with what they were doing: call start_case again.`,
    block("THE MAPPING save_mapping takes, as one JSON object with these keys:", TEMPLATE),
    "Set PEEKO_MAPPING to keep the file somewhere else.",
  ].join("\n\n")
}
