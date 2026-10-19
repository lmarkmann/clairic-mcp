import type { FieldSpec } from "./fields";

import { env } from "cloudflare:workers";

import { backoffMs } from "../lib/http";

export interface ClairicImage {
	content_type: string;
	base64: string;
}

export interface ClairicRequest {
	state: string;
	fields: Record<string, FieldSpec>;
	images?: ClairicImage[];
	reference_date?: string;
	options?: { include_quantiles?: boolean };
}

// Start and end character offsets into the state.
type Span = number[];

// Numbers, or ISO dates for date estimates.
export interface Distribution {
	value: unknown;
	mean?: unknown;
	median?: unknown;
	p10?: unknown;
	p90?: unknown;
	p_below?: number;
	p_above?: number;
	quantiles?: unknown[];
}

export interface ClairicAnswer extends Distribution {
	type: string;
	guess?: unknown;
	p_null?: number;
	confidence?: number;
	unit?: string;
	span?: Span;
	spans?: Span[];
	steps?: Distribution[];
}

export interface ClairicResponse {
	answers: Record<string, ClairicAnswer>;
	truncated: boolean;
	usage: {
		input_tokens: number;
		state_tokens?: number;
		image_tokens?: number;
		schema_tokens?: number;
		passes?: number;
	};
}

export class ClairicError extends Error {
	// True when Clairic refused the request itself, so sending it again unchanged cannot help.
	readonly rejected: boolean;

	constructor(message: string, rejected: boolean) {
		super(message);
		this.rejected = rejected;
	}
}

// Workers AI reports a request Clairic refuses as "3030: AiError: AiError: <reason> (<request id>)".
const rejectedCode = "3030";

function toClairicError(error: unknown): ClairicError {
	const message = error instanceof Error ? error.message : String(error);
	const code = /^(\d{4}):/.exec(message)?.[1];
	const reason = message
		.replace(/^\d{4}:\s*/, "")
		.replace(/^(AiError:\s*)+/, "")
		.replace(/\s*\([0-9a-f-]{36}\)$/, "");
	return new ClairicError(reason, code === rejectedCode);
}

export async function runClairic(request: ClairicRequest): Promise<ClairicResponse> {
	const inputs = { model: "clairic", ...request };
	for (let attempt = 1; ; attempt++) {
		let response: unknown;
		try {
			response = await env.AI.run("@cf/cloudflare/clairic", inputs);
		} catch (error) {
			const failure = toClairicError(error);
			if (failure.rejected || attempt === 2) throw failure;
			await new Promise((resolve) => setTimeout(resolve, backoffMs(attempt)));
			continue;
		}
		if (isClairicResponse(response)) return response;
		throw new ClairicError(
			"its response had no answers or usage; the preview API may have changed",
			false,
		);
	}
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

const isClairicResponse = (value: unknown): value is ClairicResponse =>
	isRecord(value) && isRecord(value.answers) && isRecord(value.usage);
