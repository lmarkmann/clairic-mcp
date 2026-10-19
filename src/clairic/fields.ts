import * as z from "zod";

// Option texts follow Clairic's own input schema, so the caller reads the same rules the model enforces.
const instructions = z
	.string()
	.optional()
	.describe(
		"What the field should contain, in plain language, e.g. 'Total amount due, including tax and shipping, after discounts'. The main lever on accuracy.",
	);
const nullThreshold = z
	.number()
	.gt(0)
	.max(1)
	.optional()
	.describe("Probability of null above which the value is null (default 0.5).");
const unit = z.string().optional().describe("Unit label, e.g. 'USD' or 'kWh'.");
const integer = z.boolean().optional();
const decimals = z.number().int().min(0).max(6).optional();
export const isoDate = z.iso.date();
const bound = z.union([z.number(), isoDate]);
const scale = z.enum(["linear", "log"]).optional();

// Strict objects, so a misspelled option fails validation instead of being dropped unseen.
const simple = (
	type: "text" | "date" | "time" | "datetime",
	description: string,
) =>
	z
		.strictObject({
			type: z.literal(type),
			instructions,
			null_threshold: nullThreshold,
		})
		.describe(description);

export const fieldSpec = z.discriminatedUnion("type", [
	simple("text", "An exact span copied from the input, with its line number."),
	z
		.strictObject({
			type: z.literal("number"),
			instructions,
			unit,
			integer,
			decimals,
			null_threshold: nullThreshold,
		})
		.describe(
			"A number read from the input or worked out from it in one or two steps.",
		),
	simple("date", "A calendar date, ISO form."),
	simple("time", "A time of day, ISO form."),
	simple("datetime", "A date and time, ISO form."),
	z
		.strictObject({
			type: z.literal("duration"),
			instructions,
			unit: z
				.enum([
					"seconds",
					"minutes",
					"hours",
					"days",
					"weeks",
					"months",
					"years",
				])
				.optional()
				.describe("Default seconds."),
			integer,
			decimals,
			null_threshold: nullThreshold,
		})
		.describe("A length of time, e.g. days between two dates in the input."),
	z
		.strictObject({
			type: z.literal("list"),
			instructions,
			items: z.enum(["text", "number", "date"]),
			unit,
			decimals: decimals.describe("Number lists only."),
		})
		.describe(
			"Every matching value, in input order. Empty when nothing matches.",
		),
	z
		.strictObject({
			type: z.literal("estimate"),
			instructions,
			min: bound.describe(
				"Lowest allowed value: a number, or an ISO date for date estimates.",
			),
			max: bound.describe(
				"Highest allowed value: a number, or an ISO date for date estimates.",
			),
			step: z
				.union([z.number().positive(), z.enum(["month", "year"])])
				.optional()
				.describe(
					"Grid of the answer: a positive number (days for date estimates), or month/year.",
				),
			scale,
			unit,
		})
		.describe(
			"A value the input does not state but gives evidence for (comparables, history, description). Returns a median and an 80% interval; without evidence the interval is wide.",
		),
	z
		.strictObject({
			type: z.literal("forecast"),
			instructions,
			min: bound,
			max: bound,
			horizon: z
				.number()
				.int()
				.min(1)
				.max(64)
				.describe("Number of future steps."),
			interval: z.enum([
				"step",
				"minute",
				"hour",
				"day",
				"week",
				"month",
				"quarter",
				"year",
			]),
			step: z
				.union([z.number().positive(), z.enum(["month", "year"])])
				.optional(),
			scale,
			unit,
		})
		.describe(
			"Future values of a series in the input, one estimate per step. Basic: later steps flatten toward the average.",
		),
]);

export type FieldSpec = z.infer<typeof fieldSpec>;

export const fieldName = z.string().regex(/^[A-Za-z_][A-Za-z0-9_.-]{0,63}$/);

export const fieldSpecs = z
	.record(fieldName, fieldSpec)
	.describe(
		"Map of field name to typed spec; descriptive snake_case names help. No upper limit: thirty fields cost about the same as three.",
	);
