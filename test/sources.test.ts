import { beforeEach, expect, test, vi } from "vitest";

import { htmlToText, imageType, loadImage, loadText, maxImageBytes } from "../src/clairic/sources";

const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

let served: Response;

beforeEach(() => {
	vi.stubGlobal("fetch", () => Promise.resolve(served));
});

test("reduces HTML to text with one block per line", () => {
	const html = `<html><head><title>x</title><style>p{}</style></head><body>
		<h1>Order&nbsp;A-88412</h1><script>track()</script>
		<p>Total: &pound;649 + &#163;52.10 &amp; VAT</p><!-- hidden --><ul><li>one</li><li>two</li></ul></body></html>`;
	expect(htmlToText(html)).toBe("Order A-88412\nTotal: £649 + £52.10 & VAT\none\ntwo");
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
	["application/zip", /reads text and PNG, JPEG or WebP/],
])("refuses %s as text", async (contentType, message) => {
	served = new Response("x", { headers: { "content-type": contentType } });
	await expect(loadText("https://example.com/f")).rejects.toThrow(message);
});

test("recognises images by their bytes, whatever the server calls them", async () => {
	expect(imageType(png)).toBe("image/png");
	expect(imageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
	expect(imageType(new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
	served = new Response(png, { headers: { "content-type": "application/octet-stream" } });
	const { image, bytes } = await loadImage("https://example.com/receipt");
	expect(image).toEqual({ content_type: "image/png", base64: btoa(String.fromCharCode(...png)) });
	expect(bytes).toBe(png.length);
});

test("refuses files that are not images and images over 4 MiB", async () => {
	served = new Response("<html>");
	await expect(loadImage("https://example.com/page")).rejects.toThrow(/not a PNG, JPEG or WebP/);
	const big = new Uint8Array(maxImageBytes + 1);
	big.set(png);
	served = new Response(big);
	await expect(loadImage("https://example.com/big.png")).rejects.toThrow(/up to 4 MiB/);
});
