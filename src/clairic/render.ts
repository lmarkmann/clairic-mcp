import type { ClairicAnswer, ClairicResponse, Distribution } from "./client";
import type { FieldSpec } from "./fields";

// A convention, not derived: answers outside these bounds are marked for the user to verify.
export const review = { minConfidence: 0.9, unsureNullLow: 0.1, unsureNullHigh: 0.9 } as const;

export function probability(p: number): string {
	if (p < 0.001) return "<0.001";
	if (p > 0.999) return ">0.999";
	return p.toFixed(3);
}

// Newline offsets are found once, so a long list of spans does not rescan the state per item.
export function lineFinder(state: string): (offset: number) => number {
	const breaks = Array.from(state.matchAll(/\n/g), (match) => match.index);
	return (offset) => {
		let low = 0;
		let high = breaks.length;
		while (low < high) {
			const middle = (low + high) >>> 1;
			if (breaks[middle]! < offset) low = middle + 1;
			else high = middle;
		}
		return low + 1;
	};
}

const show = (value: unknown) =>
	typeof value === "string" ? JSON.stringify(value) : String(value);
// Below 1, three significant digits instead of two decimals, so small estimates do not print as 0.
const round = (value: unknown) => {
	if (typeof value !== "number") return String(value);
	return String(Number(Math.abs(value) < 1 ? value.toPrecision(3) : value.toFixed(2)));
};

function needsCheck(answer: ClairicAnswer): boolean {
	const unsureNull =
		answer.p_null !== undefined &&
		answer.p_null > review.unsureNullLow &&
		answer.p_null < review.unsureNullHigh;
	const weak =
		answer.value !== null &&
		answer.confidence !== undefined &&
		answer.confidence < review.minConfidence;
	return unsureNull || weak;
}

function distribution(estimate: Distribution, unit: string): string {
	const parts = [
		`median ${round(estimate.median)}`,
		`80% interval ${round(estimate.p10)} to ${round(estimate.p90)}`,
	];
	if (estimate.mean !== undefined) parts.push(`mean ${round(estimate.mean)}`);
	if ((estimate.p_below ?? 0) > 0.05)
		parts.push(`p_below ${probability(estimate.p_below!)}: lower min`);
	if ((estimate.p_above ?? 0) > 0.05)
		parts.push(`p_above ${probability(estimate.p_above!)}: raise max`);
	if (estimate.quantiles)
		parts.push(`percentiles 1 to 99: ${estimate.quantiles.map(round).join(", ")}`);
	return `${round(estimate.value)}${unit} (${parts.join(", ")})`;
}

function renderAnswer(
	name: string,
	answer: ClairicAnswer,
	spec: FieldSpec | undefined,
	lineAt: ((offset: number) => number) | undefined,
): string[] {
	const label = answer.unit ?? (spec && "unit" in spec ? spec.unit : undefined);
	const unit = label ? ` ${label}` : "";
	const check = needsCheck(answer) ? " [check]" : "";
	const line = (offset: number | undefined) =>
		offset !== undefined && lineAt ? `line ${lineAt(offset)}` : undefined;

	if (answer.type === "forecast" && answer.steps) {
		return [
			`${name}: ${answer.steps.length} steps ahead`,
			...answer.steps.map((step, index) => `  ${index + 1}: ${distribution(step, unit)}`),
		];
	}
	if (answer.type === "estimate") {
		return [`${name}: ${distribution(answer, unit)}`];
	}
	if (Array.isArray(answer.value)) {
		const confidence =
			answer.confidence === undefined ? "" : ` (confidence ${probability(answer.confidence)})`;
		if (!answer.value.length) return [`${name}: none found${confidence}${check}`];
		return [
			`${name}: ${answer.value.length} item${answer.value.length === 1 ? "" : "s"}${confidence}${check}`,
			...answer.value.map((item, index) => {
				const where = line(answer.spans?.[index]?.[0]);
				return `  - ${show(item)}${unit}${where ? ` (${where})` : ""}`;
			}),
		];
	}
	if (answer.value === null) {
		const parts = [`p_null ${probability(answer.p_null ?? 1)}`];
		if (answer.guess !== undefined && answer.guess !== null) {
			const confidence =
				answer.confidence === undefined ? "" : ` at confidence ${probability(answer.confidence)}`;
			parts.push(`best guess ${show(answer.guess)}${unit}${confidence}`);
		}
		return [`${name}: null (${parts.join("; ")})${check}`];
	}
	const parts = [line(answer.span?.[0])];
	if (answer.confidence !== undefined) parts.push(`confidence ${probability(answer.confidence)}`);
	if (answer.p_null !== undefined) parts.push(`p_null ${probability(answer.p_null)}`);
	return [`${name}: ${show(answer.value)}${unit} (${parts.filter(Boolean).join(", ")})${check}`];
}

export function renderAnswers(
	response: ClairicResponse,
	context: { state: string; fields: Record<string, FieldSpec>; referenceDate: string },
): string {
	const answers = Object.entries(response.answers);
	const lineAt = context.state ? lineFinder(context.state) : undefined;
	const lines = answers.flatMap(([name, answer]) =>
		renderAnswer(name, answer, context.fields[name], lineAt),
	);
	const { input_tokens, passes = 1 } = response.usage;
	lines.push(
		"",
		`Reference date ${context.referenceDate}. Clairic read ${input_tokens} input tokens in ${passes} pass${passes === 1 ? "" : "es"}.`,
	);
	if (answers.some(([, answer]) => needsCheck(answer))) {
		lines.push(
			`[check] marks answers with confidence under ${review.minConfidence} or p_null between ${review.unsureNullLow} and ${review.unsureNullHigh}. Tell the user to verify them; do not present them as fact.`,
		);
	}
	if (response.truncated) {
		lines.push(
			"The input did not fit Clairic's 65,536-token window, so it read only the start; later text is missing from these answers. For a url, call again with a later offset; otherwise send the relevant part of the text.",
		);
	}
	return lines.join("\n");
}
