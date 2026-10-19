# clairic-mcp

An MCP server that gives you Cloudflare's [Clairic](https://developers.cloudflare.com/workers-ai/models/clairic/) model as one tool, `extract`. It runs as a Worker on your own Cloudflare account, behind Cloudflare Access.

You send `extract` an input (text, a public web page or up to four images) and a list of fields, each with a name and a type. Clairic gives back one answer per field: a value of that type, or null when the input doesn't settle it. Each answer carries a `confidence`, the chance the value is right, and a `p_null`, the chance the input has no value for the field. Text answers also say which line they came from. Clairic answers in one fast pass and doesn't reason step by step, so the assistant calling it picks the fields and does any arithmetic longer than a step or two.

## Setup

You need:

- a Cloudflare account with a domain on it
- a Zero Trust team, which is free, with at least one login method (One-time PIN is enough)
- an API token with **Access: Apps and Policies Write**, used once by `just access`
- Node 24, pnpm, [just](https://github.com/casey/just), curl and jq

```sh
git clone https://github.com/lmarkmann/clairic-mcp && cd clairic-mcp
pnpm install
pnpm exec wrangler login
cp .env.example .env    # your account id, domain, team, allowed emails and the API token
just access             # creates the Access app and policy, writes ACCESS_AUD to .env
just deploy             # runs the checks, then deploys to your domain
```

Everything specific to your deployment lives in `.env`, which git ignores. The Worker rejects every request until `ACCESS_AUD` is set, so a deploy without `just access` serves nothing.

Access sits in front of the whole hostname and acts as the OAuth server: a client registers itself, sends you to your team's login page, and only emails on the `clairic-mcp users` policy get through.

## Connect

Claude Code:

```sh
claude mcp add --transport http clairic https://<your domain>/mcp
```

pi:

```sh
pi mcp add clairic --url https://<your domain>/mcp
```

Then sign in when the client asks (`/mcp` in either one). Other clients take the same URL as a remote MCP server with the client ID and secret left empty. Access accepts callbacks on localhost and the hosted callback listed under `allowed_uris` in the `justfile`; add any other hosted callback there before you run `just access`.

Clients keep the tool list from when they connected, so reconnect after an update changes the tool.

## Example

The input:

```
Invoice INV-2291 from Northwind Supply, issued 2026-09-02, net 30.
4 pallets at $250.00 each, shipping $80.00.
```

The fields:

```json
{
  "due_date": { "type": "date", "instructions": "Issue date plus the net payment days" },
  "total": { "type": "number", "decimals": 2, "unit": "USD", "instructions": "Amount due including shipping" },
  "po_number": { "type": "text", "instructions": "Purchase order number" },
  "days_to_pay": { "type": "estimate", "min": 0, "max": 120, "step": 1, "instructions": "Days after issue until this invoice is paid" }
}
```

The answers:

```
due_date: "2026-10-02" (confidence >0.999, p_null <0.001)
total: 1080 USD (confidence >0.999, p_null <0.001)
po_number: null (p_null >0.999; best guess "INV-2291" at confidence >0.999)
days_to_pay: 31 (median 31, 80% interval 24 to 38, mean 31.32)
```

The due date and the total are computed, not copied. The invoice has no purchase order number, so `po_number` is null; the best guess next to it is what Clairic would say if forced to pick, not an answer. An answer with confidence under 0.9, or a p_null between 0.1 and 0.9, is marked `[check]`, and the tool tells the client to have you verify it.

## Field types

| Type | You get |
| --- | --- |
| `text` | A piece of the input, quoted as written, with its line number |
| `number`, `duration` | A number, optionally with a unit, fixed decimals or a whole number |
| `date`, `time`, `datetime` | An ISO value; dates without a year are read relative to the reference date |
| `list` | Every match, as text, numbers or dates |
| `estimate` | A median and an 80% interval between the `min` and `max` you set |
| `forecast` | One estimate per step ahead, from a series in the input |
