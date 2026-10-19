import type { ClairicResponse } from "../src/clairic/client";
import type { FieldSpec } from "../src/clairic/fields";

import { expect, test } from "vitest";

import { lineFinder, probability, renderAnswers } from "../src/clairic/render";
import forecast from "./fixtures/clairic/forecast.json";
import invoice from "./fixtures/clairic/invoice.json";
import { invoiceFields, invoiceState } from "./support/invoice";

const render = (
	response: ClairicResponse,
	fields = invoiceFields,
	state = invoiceState,
) => renderAnswers(response, { state, fields, referenceDate: "2026-10-19" });

test("renders every answer type of the recorded invoice", () => {
	expect(render(invoice).split("\n")).toEqual([
		'invoice_number: "INV-2291" (line 1, confidence >0.999, p_null <0.001)',
		'due_date: "2026-10-02" (confidence >0.999, p_null <0.001)',
		"total: 1080 USD (confidence >0.999, p_null <0.001)",
		"contacts: 2 items (confidence >0.999)",
		'  - "Dana Ruiz" (line 3)',
		'  - "Priya Shah" (line 3)',
		'po_number: null (p_null >0.999; best guess "INV-2291" at confidence >0.999)',
		"days_to_pay: 31 (median 31, 80% interval 24 to 38, mean 31.32)",
		"payment_term: 30 days (confidence >0.999, p_null <0.001)",
		"",
		"Reference date 2026-10-19. Clairic read 688 input tokens in 3 passes.",
	]);
});

test("renders a forecast one step per line", () => {
	const fields: Record<string, FieldSpec> = {
		next_months: {
			type: "forecast",
			min: 0,
			max: 600,
			horizon: 3,
			interval: "month",
			unit: "kWh",
		},
	};
	expect(render(forecast, fields, "").split("\n").slice(0, 4)).toEqual([
		"next_months: 3 steps ahead",
		"  1: 225.91 kWh (median 225.43, 80% interval 201.59 to 250.42, mean 225.91)",
		"  2: 230.24 kWh (median 229.35, 80% interval 199.24 to 263.51, mean 230.24)",
		"  3: 232.16 kWh (median 230.94, 80% interval 195.8 to 271.59, mean 232.16)",
	]);
});

test("marks weak and unsure answers for review and explains the mark", () => {
	const response: ClairicResponse = {
		answers: {
			weak: { type: "number", value: 12, confidence: 0.6, p_null: 0.01 },
			unsure_null: {
				type: "text",
				value: null,
				p_null: 0.7,
				guess: "x",
				confidence: 0.5,
			},
			sure_null: { type: "text", value: null, p_null: 0.98 },
		},
		truncated: false,
		usage: { input_tokens: 10, passes: 1 },
	};
	const lines = render(response, {}, "").split("\n");
	expect(lines[0]).toBe("weak: 12 (confidence 0.600, p_null 0.010) [check]");
	expect(lines[1]).toBe(
		'unsure_null: null (p_null 0.700; best guess "x" at confidence 0.500) [check]',
	);
	expect(lines[2]).toBe("sure_null: null (p_null 0.980)");
	expect(lines.at(-1)).toMatch(/^\[check\] marks answers/);
});

test("flags estimates clipped by their bounds and truncated input", () => {
	const response: ClairicResponse = {
		answers: {
			price: {
				type: "estimate",
				value: 100,
				median: 100,
				p10: 90,
				p90: 100,
				p_above: 0.3,
			},
		},
		truncated: true,
		usage: { input_tokens: 65_536 },
	};
	const text = render(response, {}, "");
	expect(text).toContain("p_above 0.300: raise max");
	expect(text).toContain("read only the start");
});

test("keeps small estimates readable and marks an unsure empty list", () => {
	const response: ClairicResponse = {
		answers: {
			rate: {
				type: "estimate",
				value: 0.00034,
				median: 0.00031,
				p10: 0.000125,
				p90: 0.0009,
			},
			damage: { type: "list", value: [], confidence: 0.4 },
		},
		truncated: false,
		usage: { input_tokens: 10 },
	};
	const lines = render(response, {}, "").split("\n");
	expect(lines[0]).toBe(
		"rate: 0.00034 (median 0.00031, 80% interval 0.000125 to 0.0009)",
	);
	expect(lines[1]).toBe("damage: none found (confidence 0.400) [check]");
});

test("line numbers count newlines before the offset", () => {
	const lineAt = lineFinder("a\nb\nc");
	expect(lineAt(0)).toBe(1);
	expect(lineAt(1)).toBe(1);
	expect(lineAt(2)).toBe(2);
	expect(lineAt(4)).toBe(3);
	expect(lineAt(99)).toBe(3);
	expect(probability(0.5)).toBe("0.500");
});
