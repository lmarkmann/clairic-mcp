import { beforeEach, expect, test, vi } from "vitest";

import {
	htmlToText,
	imageType,
	loadImage,
	loadText,
	maxImageBytes,
	maxTextBytes,
} from "../src/clairic/sources";
import { UpstreamError } from "../src/lib/http";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let served: Response;

beforeEach(() => {
	vi.stubGlobal("fetch", () => Promise.resolve(served));
});

test("reduces HTML to text with one block per line", () => {
	const html = `<html><head><title>x</title><style>p{}</style></head><body>
		<h1>Order&nbsp;A-88412</h1><script>track()</script>
		<p>Total: &pound;649 + &#163;52.10 &amp; VAT</p><!-- hidden --><ul><li>one</li><li>two</li></ul></body></html>`;
	expect(htmlToText(html)).toBe("x\nOrder A-88412\nTotal: £649 + £52.10 & VAT\none\ntwo");
});

test("decodes the common typographic entities", () => {
	const decoded = htmlToText("&rsquo;&ldquo;&ndash;&hellip;");
	expect(Array.from(decoded, (character) => character.codePointAt(0))).toEqual([
		0x2019, 0x201c, 0x2013, 0x2026,
	]);
});

test("decodes text in the charset the server names", async () => {
	served = new Response(new Uint8Array([0xa3, 0x36, 0x34, 0x39]), {
		headers: { "content-type": "text/plain; charset=ISO-8859-1" },
	});
	expect(await loadText("https://example.com/latin1.txt")).toBe("£649");
});

test("reports a body that breaks off as an upstream failure", async () => {
	served = new Response(
		new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array([0x61]));
				controller.error(new Error("connection reset"));
			},
		}),
		{ headers: { "content-type": "text/plain" } },
	);
	await expect(loadText("https://example.com/reset.txt")).rejects.toBeInstanceOf(UpstreamError);
});

test("passes plain text and JSON through", async () => {
	served = new Response('{"total": 12}', {
		headers: { "content-type": "application/json; charset=utf-8" },
	});
	expect(await loadText("https://example.com/a.json")).toBe('{"total": 12}');
});

test.each([
	["application/pdf", /is a PDF/],
	["image/png", /pass it in image_urls/],
	["image/gif", /reads text and PNG, JPEG or WebP/],
	["application/zip", /reads text and PNG, JPEG or WebP/],
])("refuses %s as text", async (contentType, message) => {
	served = new Response("x", { headers: { "content-type": contentType } });
	await expect(loadText("https://example.com/f")).rejects.toThrow(message);
});

test("recognises images by their bytes, whatever the server calls them", async () => {
	expect(imageType(png)).toBe("image/png");
	expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
	expect(imageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
	served = new Response(png, {
		headers: { "content-type": "application/octet-stream" },
	});
	expect(await loadImage("https://example.com/receipt")).toEqual({
		contentType: "image/png",
		bytes: png,
	});
});

test("refuses files that are not images and images over 4 MiB", async () => {
	served = new Response("<html>");
	await expect(loadImage("https://example.com/page")).rejects.toThrow(/not a PNG, JPEG or WebP/);
	const big = new Uint8Array(maxImageBytes + 1);
	big.set(png);
	served = new Response(big);
	await expect(loadImage("https://example.com/big.png")).rejects.toThrow(/larger than 4 MiB/);
	served = new Response(png, {
		headers: { "content-length": String(maxImageBytes + 1) },
	});
	await expect(loadImage("https://example.com/big.png")).rejects.toThrow(/larger than 4 MiB/);
});

test("refuses text larger than the cap without reading it whole", async () => {
	served = new Response(new Uint8Array(maxTextBytes + 1), {
		headers: { "content-type": "text/plain" },
	});
	await expect(loadText("https://example.com/huge.txt")).rejects.toThrow(/larger than 8 MiB/);
});
