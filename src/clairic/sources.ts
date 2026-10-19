import type { ClairicImage } from "./client";

import { fetchSource, readCapped } from "../lib/http";
import { ToolInputError } from "../lib/result";

export const maxImageBytes = 4 * 1024 * 1024;
export const maxImagesBytes = 8 * 1024 * 1024;
// Pages carry markup on top of the 400,000 characters Clairic is sent; anything larger is refused unread.
export const maxTextBytes = 8 * 1024 * 1024;

const entities: Record<string, string> = {
	amp: "&",
	lt: "<",
	gt: ">",
	quot: '"',
	apos: "'",
	nbsp: " ",
	pound: "£",
	euro: "€",
	cent: "¢",
	yen: "¥",
};

function decodeEntities(text: string): string {
	return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, name: string) => {
		if (name[0] !== "#") return entities[name.toLowerCase()] ?? match;
		const code =
			name[1] === "x" || name[1] === "X" ? parseInt(name.slice(2), 16) : Number(name.slice(1));
		return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
	});
}

// Block-level closing tags become line breaks so line numbers in answers still mean something.
export function htmlToText(html: string): string {
	return decodeEntities(
		html
			.replace(/<(script|style|noscript|template|svg)\b[\s\S]*?<\/\1\s*>/gi, " ")
			.replace(/<!--[\s\S]*?-->/g, " ")
			.replace(
				/<(br|hr)\b[^>]*>|<\/(title|p|div|li|tr|h[1-6]|table|section|article|header|footer)\s*>/gi,
				"\n",
			)
			.replace(/<[^>]+>/g, " "),
	)
		.replace(/[^\S\n]+/g, " ")
		.replace(/ *\n */g, "\n")
		.replace(/\n{2,}/g, "\n")
		.trim();
}

const textTypes = /^(text\/|application\/(json|xml|[\w.+-]+\+(json|xml))$)/;

export async function loadText(url: string): Promise<string> {
	const response = await fetchSource(url);
	const contentType = (response.headers.get("content-type") ?? "")
		.split(";")[0]!
		.trim()
		.toLowerCase();
	const html = contentType === "text/html" || contentType === "application/xhtml+xml";
	if (html || textTypes.test(contentType) || contentType === "") {
		const bytes = await readCapped(response, maxTextBytes);
		if (!bytes) {
			throw new ToolInputError(
				`${url} is larger than ${maxTextBytes / 2 ** 20} MiB. Ask the user for the relevant part as text.`,
			);
		}
		const text = new TextDecoder().decode(bytes);
		return html ? htmlToText(text) : text;
	}
	await response.body?.cancel();
	if (contentType.startsWith("image/")) {
		throw new ToolInputError(`${url} is an image; pass it in image_urls instead of url.`);
	}
	if (contentType === "application/pdf") {
		throw new ToolInputError(
			`${url} is a PDF, which Clairic cannot read. Ask the user to paste its text, or pass public URLs of page screenshots in image_urls.`,
		);
	}
	throw new ToolInputError(
		`${url} is ${contentType}; Clairic reads text and PNG, JPEG or WebP images only.`,
	);
}

// The bytes decide the type: hosts often serve images as application/octet-stream.
export function imageType(bytes: Uint8Array): string | undefined {
	const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
	if (bytes[0] === 0x89 && ascii(1, 4) === "PNG") return "image/png";
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
	if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
	return undefined;
}

function base64(bytes: Uint8Array): string {
	let binary = "";
	for (let start = 0; start < bytes.length; start += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
	}
	return btoa(binary);
}

export async function loadImage(url: string): Promise<{ image: ClairicImage; bytes: number }> {
	const bytes = await readCapped(await fetchSource(url), maxImageBytes);
	if (!bytes) throw new ToolInputError(`${url} is larger than 4 MiB, Clairic's limit per image.`);
	const contentType = imageType(bytes);
	if (!contentType) throw new ToolInputError(`${url} is not a PNG, JPEG or WebP image.`);
	return { image: { content_type: contentType, base64: base64(bytes) }, bytes: bytes.length };
}
