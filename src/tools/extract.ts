import type { McpServer } from "@modelcontextprotocol/server";

import * as z from "zod";

import { type ClairicImage, runClairic } from "../clairic/client";
import { fieldSpecs, isoDate } from "../clairic/fields";
import { renderAnswers } from "../clairic/render";
import {
	base64,
	loadImage,
	loadText,
	maxImagesBytes,
} from "../clairic/sources";
import { runTool, ToolInputError } from "../lib/result";

// About 100k tokens, past Clairic's 65,536-token window; it truncates the rest and says so.
const maxStateCharacters = 400_000;

const webUrl = z.url({ protocol: /^https?$/ });

export function registerExtractTools(server: McpServer) {
	server.registerTool(
		"extract",
		{
			title: "Extract typed values with Clairic",
			description: `Answer a schema of typed fields from text, a web page or images with Clairic, Cloudflare's extraction model. Every answer is a value of the requested type or null, never invented text, and comes with its doubt: confidence and p_null for single values, a median and 80% interval for estimates and forecasts, line numbers for text copied from the input.

Use it when the answer is a value: something to read (an order number, a deadline), compute in one or two steps (a total including tax, days between two dates), estimate from evidence (a fair price from comparable listings) or forecast from a series. Write the fields yourself from what the user needs; give each one instructions. It cannot judge or summarise: ask it for values, not opinions.

Arithmetic over many steps or many table rows is unreliable: extract the inputs as separate fields and do the maths yourself. Answers marked [check] are uncertain; tell the user to verify them instead of stating them as fact. A null means the input does not determine the value; the best guess shown next to it is not an answer.`,
			inputSchema: z.object({
				text: z
					.string()
					.optional()
					.describe("The text to read. Exclusive with url."),
				url: webUrl
					.optional()
					.describe(
						"A public page or text document the server fetches; HTML is reduced to its text. Not for PDFs or anything behind a login.",
					),
				image_urls: z
					.array(webUrl)
					.max(4)
					.optional()
					.describe(
						"Up to 4 public PNG, JPEG or WebP images (4 MiB each, 8 MiB together), read before the text, e.g. a photo of a receipt.",
					),
				fields: fieldSpecs,
				reference_date: isoDate
					.optional()
					.describe(
						"ISO date for 'today' and for dates written without a year. Defaults to the current UTC date.",
					),
				include_quantiles: z
					.boolean()
					.default(false)
					.describe("Also return all 99 percentiles of estimates."),
				offset: z
					.number()
					.int()
					.min(0)
					.default(0)
					.describe(
						"url only: character offset into the page text, for pages Clairic truncated.",
					),
			}),
			annotations: { readOnlyHint: true, openWorldHint: true },
		},
		({
			text,
			url,
			image_urls,
			fields,
			reference_date,
			include_quantiles,
			offset,
		}) =>
			runTool(async () => {
				if (text !== undefined && url)
					throw new ToolInputError("Send either text or url, not both.");
				if (!text && !url && !image_urls?.length) {
					throw new ToolInputError(
						"Send the input as text, url or image_urls.",
					);
				}
				if (offset && !url)
					throw new ToolInputError("offset applies to url only.");
				if (!Object.keys(fields).length)
					throw new ToolInputError("Define at least one field.");

				const [page, loaded] = await Promise.all([
					url ? loadText(url) : undefined,
					Promise.all((image_urls ?? []).map(loadImage)),
				]);
				const totalBytes = loaded.reduce(
					(sum, { bytes }) => sum + bytes.length,
					0,
				);
				if (totalBytes > maxImagesBytes) {
					throw new ToolInputError(
						`The images total ${(totalBytes / 2 ** 20).toFixed(1)} MiB; Clairic takes 8 MiB at most. Send fewer.`,
					);
				}
				const images: ClairicImage[] = loaded.map(({ contentType, bytes }) => ({
					content_type: contentType,
					base64: base64(bytes),
				}));
				const input = page ?? text ?? "";
				const state = input.slice(offset, offset + maxStateCharacters);
				if (url && !state)
					throw new ToolInputError(`${url} has no text at offset ${offset}.`);
				const referenceDate =
					reference_date ?? new Date().toISOString().slice(0, 10);

				const response = await runClairic({
					state,
					fields,
					...(images.length && { images }),
					reference_date: referenceDate,
					...(include_quantiles && { options: { include_quantiles } }),
				});
				const source = url
					? `Read ${url}${offset ? ` from character ${offset}` : ""} (${state.length} of ${input.length} characters).\n\n`
					: "";
				const end = offset + state.length;
				const cut =
					!response.truncated && end < input.length
						? `\nOnly characters ${offset} to ${end} of ${input.length} were sent. ${url ? `Call again with offset ${end} for the rest.` : "Send the rest of the text in another call."}`
						: "";
				return (
					source +
					renderAnswers(response, { state, fields, referenceDate }) +
					cut
				);
			}),
	);
}
