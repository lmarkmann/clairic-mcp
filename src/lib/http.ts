import { version } from "../../package.json";

export const userAgent = `clairic-mcp/${version}`;

export class UpstreamError extends Error {
	readonly status: number;
	readonly url: string;
	readonly attempts: number;
	readonly retryAfterMs?: number;

	constructor(status: number, url: string, attempts: number, retryAfterMs?: number) {
		super(`${url} answered ${status || "nothing"} after ${attempts} attempts`);
		this.status = status;
		this.url = url;
		this.attempts = attempts;
		this.retryAfterMs = retryAfterMs;
	}
}

const retriedStatuses = new Set([408, 425, 429, 500, 502, 503, 504]);
const maxAttempts = 4;
const attemptTimeoutMs = 20_000;
// Total time one call may spend retrying; a tool call should answer, even with an error, within it.
const budgetMs = 30_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Full jitter: a random wait up to an exponentially growing cap.
export const backoffMs = (attempt: number) => Math.random() * Math.min(8_000, 500 * 2 ** attempt);

export function serverWaitMs(headers: Headers, now: number): number | undefined {
	const retryAfter = headers.get("retry-after");
	if (retryAfter) {
		const seconds = Number(retryAfter);
		if (Number.isFinite(seconds)) return seconds * 1000;
		const date = Date.parse(retryAfter);
		if (!Number.isNaN(date)) return Math.max(0, date - now);
	}
	const reset = Number(headers.get("x-ratelimit-reset"));
	return reset ? Math.max(0, reset * 1000 - now) : undefined;
}

// Reads at most maxBytes, so a huge file cannot exhaust the isolate's memory; undefined when larger.
export async function readCapped(
	response: Response,
	maxBytes: number,
): Promise<Uint8Array | undefined> {
	if (Number(response.headers.get("content-length")) > maxBytes) {
		await response.body?.cancel();
		return undefined;
	}
	const reader = response.body?.getReader();
	if (!reader) return new Uint8Array();
	const chunks: Uint8Array[] = [];
	let total = 0;
	for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
		total += chunk.value.length;
		if (total > maxBytes) {
			await reader.cancel();
			return undefined;
		}
		chunks.push(chunk.value);
	}
	const bytes = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.length;
	}
	return bytes;
}

// Returns the response unread, so the caller decides between text and bytes.
export async function fetchSource(url: string): Promise<Response> {
	const deadline = Date.now() + budgetMs;
	for (let attempt = 1; ; attempt++) {
		let status = 0;
		let wait: number | undefined;
		try {
			const response = await fetch(url, {
				headers: { "user-agent": userAgent },
				signal: AbortSignal.timeout(
					Math.max(1_000, Math.min(attemptTimeoutMs, deadline - Date.now())),
				),
			});
			if (response.ok) return response;
			await response.body?.cancel();
			status = response.status;
			if (!retriedStatuses.has(status)) throw new UpstreamError(status, url, attempt);
			wait = serverWaitMs(response.headers, Date.now());
		} catch (error) {
			if (error instanceof UpstreamError) throw error;
		}
		const delay = wait ?? backoffMs(attempt);
		if (attempt === maxAttempts || Date.now() + delay > deadline) {
			throw new UpstreamError(status, url, attempt, wait);
		}
		await sleep(delay);
	}
}
