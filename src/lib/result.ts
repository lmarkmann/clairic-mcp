import type { CallToolResult } from "@modelcontextprotocol/server";

import { ClairicError } from "../clairic/client";
import { UpstreamError } from "./http";

// Thrown for input a tool cannot act on; the message says what to send instead.
export class ToolInputError extends Error {}

function failure(text: string): CallToolResult {
	return { isError: true, content: [{ type: "text", text }] };
}

// Transient failures have already been retried, so these messages never ask the caller to retry at once.
export function describeUpstreamError(error: UpstreamError): string {
	const tries = `${error.attempts} attempt${error.attempts === 1 ? "" : "s"}`;
	const wait = error.retryAfterMs
		? ` It asks clients to wait ${Math.ceil(error.retryAfterMs / 1000)} seconds.`
		: "";
	if (error.status === 404) return `${error.url} returned 404; check the address.`;
	if (error.status === 401 || error.status === 403) {
		return `${error.url} needs a login or blocks scripts (HTTP ${error.status}). Ask the user to paste the text, or send a screenshot's public URL in image_urls.`;
	}
	if (error.status === 429) return `${error.url} is rate limiting this server (${tries}).${wait}`;
	if (error.status === 0) {
		return `${error.url} did not answer after ${tries}. Tell the user and offer to try again later.`;
	}
	if (error.status >= 500) {
		return `${error.url} kept failing with HTTP ${error.status} after ${tries}.${wait} Tell the user and offer to try again later.`;
	}
	return `${error.url} answered HTTP ${error.status}.`;
}

export function describeClairicError(error: ClairicError): string {
	if (error.rejected) {
		return `Clairic rejected the request: ${error.message}. Fix the field specs and call again.`;
	}
	return `Clairic failed: ${error.message}. Tell the user and offer to try again later.`;
}

export async function runTool(work: () => Promise<string>): Promise<CallToolResult> {
	try {
		return { content: [{ type: "text", text: await work() }] };
	} catch (error) {
		if (error instanceof ToolInputError) return failure(error.message);
		if (error instanceof UpstreamError) return failure(describeUpstreamError(error));
		if (error instanceof ClairicError) return failure(describeClairicError(error));
		throw error;
	}
}
