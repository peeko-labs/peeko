# Peeko

The case you send your processor. An MCP that builds a masked fraud case from the systems you already have.

Install it once with the command from your Peeko dashboard, then say "Peeko case for <customer>" in Claude Code. Claude reads your app's data through the MCPs you already run (database, analytics), writes the case in Peeko's shape, masks names, emails, phone numbers, account numbers and ID numbers, publishes the page, and hands you the link.

## How it works

- `peeko.yaml` in your repo says where each kind of data lives: one query per data kind, the columns that hold PII, and what stored codes mean. Written once per app.
- `start_case` returns the playbook for one customer: the queries with the id filled in, how to shape each section, what never goes on the page.
- `check_case` validates the draft and refuses anything that looks like raw PII. Nothing is sent.
- `publish_case` masks the values you list, validates again, publishes to Peeko and returns the link. The only call that sends anything.

Nothing leaves the machine before `publish_case`, and what leaves is masked.

## Run locally

```
npm install && npm run build
claude mcp add peeko -e PEEKO_API_KEY=pk_live_… -e PEEKO_URL=http://localhost:3000 -- node $PWD/build/index.js
```

`PEEKO_MAPPING` points at a `peeko.yaml` somewhere other than the current directory.
