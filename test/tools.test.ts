import { createMcpHandler } from "@modelcontextprotocol/server";
import { beforeEach, expect, test, vi } from "vitest";

import { createServer } from "../src/server";
import rejection from "./fixtures/clairic/inverted-bounds.txt?raw";
import invoice from "./fixtures/clairic/invoice.json";
import { stubAiRun } from "./support/cloudflare-workers";
import { invoiceFields, invoiceState } from "./support/invoice";

const mcp = createMcpHandler(createServer);

interface ToolResult {
	isError?: boolean;
	text: string;
}

async function callTool(args: Record<string, unknown>): Promise<ToolResult> {
	const response = await mcp.fetch(
		new Request("http://localhost/mcp", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				accept: "application/json, text/event-stream",
			},
			body: JSON.stringify({
				jsonrpc: "2.0",
				id: 1,
				method: "tools/call",
				params: { name: "extract", arguments: args },
			}),
		}),
	);
	const body = await response.text();
	const json = body.startsWith("{") ? body : (/^data: (.*)$/m.exec(body)?.[1] ?? "");
	const reply = JSON.parse(json).result;
	return { isError: reply.isError, text: reply.content[0].text };
}

let sent: Record<string, unknown>[];
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

beforeEach(() => {
	sent = [];
	stubAiRun((_, inputs) => {
		sent.push(inputs);
		return Promise.resolve(invoice);
	});
	vi.stubGlobal("fetch", (url: string) =>
		Promise.resolve(
			url.endsWith(".png")
				? new Response(png)
				: new Response(`<p>${invoiceState.replaceAll("\n", "</p><p>")}</p>`, {
						headers: { "content-type": "text/html" },
					}),
		),
	);
});

test("extracts from text and sends Clairic the request it documents", async () => {
	const { isError, text } = await callTool({
		text: invoiceState,
		fields: invoiceFields,
		reference_date: "2026-10-19",
	});
	expect(isError).toBeUndefined();
	expect(text).toContain("total: 1080 USD");
	expect(sent).toEqual([
		{ model: "clairic", state: invoiceState, fields: invoiceFields, reference_date: "2026-10-19" },
	]);
});

test("reads a page as text with its block structure", async () => {
	const { text } = await callTool({ url: "https://example.com/invoice", fields: invoiceFields });
	expect(sent[0]?.state).toBe(invoiceState);
	expect(sent[0]?.reference_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
	expect(text).toMatch(/^Read https:\/\/example\.com\/invoice \(\d+ of \d+ characters\)/);
});

test("says when the input was cut before Clairic saw it", async () => {
	const { text } = await callTool({ text: "x".repeat(400_005), fields: invoiceFields });
	expect(sent[0]?.state).toHaveLength(400_000);
	expect(text).toContain("Only characters 0 to 400000 of 400005 were sent.");
});

test("embeds image URLs as base64 because Clairic refuses remote URLs", async () => {
	await callTool({ image_urls: ["https://example.com/receipt.png"], fields: invoiceFields });
	expect(sent[0]?.images).toEqual([
		{ content_type: "image/png", base64: btoa(String.fromCharCode(...png)) },
	]);
	expect(sent[0]?.state).toBe("");
});

test.each([
	[{ text: "a", url: "https://example.com" }, "either text or url"],
	[{}, "as text, url or image_urls"],
	[{ text: "a", offset: 5 }, "offset applies to url only"],
])("refuses %j", async (input, message) => {
	const { isError, text } = await callTool({ ...input, fields: invoiceFields });
	expect(isError).toBe(true);
	expect(text).toContain(message);
	expect(sent).toEqual([]);
});

test("passes Clairic's own reason through when it rejects the fields", async () => {
	let calls = 0;
	stubAiRun(() => {
		calls++;
		return Promise.reject(new Error(rejection.trim()));
	});
	const { isError, text } = await callTool({
		text: "x",
		fields: { price: { type: "estimate", min: 100, max: 1 } },
	});
	expect(isError).toBe(true);
	expect(text).toBe(
		"Clairic rejected the request: estimate price needs finite min < max, got 100 and 1. Fix what it names and call again.",
	);
	expect(calls).toBe(1);
});

test("retries an unexplained Workers AI failure once", async () => {
	let calls = 0;
	stubAiRun(() => {
		calls++;
		return calls === 1
			? Promise.reject(new Error("3040: Capacity temporarily exceeded"))
			: Promise.resolve(invoice);
	});
	const { isError } = await callTool({ text: invoiceState, fields: invoiceFields });
	expect(isError).toBeUndefined();
	expect(calls).toBe(2);
});
