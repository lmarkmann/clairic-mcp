import { expect, test } from "vitest";

import { fieldSpecs } from "../src/clairic/fields";
import { invoiceFields } from "./support/invoice";

test("accepts the fields of Cloudflare's invoice example", () => {
	expect(fieldSpecs.safeParse(invoiceFields).success).toBe(true);
});

test.each([
	["an estimate without bounds", { price: { type: "estimate" } }],
	["a list without items", { names: { type: "list" } }],
	[
		"a forecast beyond 64 steps",
		{ kwh: { type: "forecast", min: 0, max: 1, horizon: 65, interval: "month" } },
	],
	["a field name Clairic refuses", { "1st total": { type: "number" } }],
	["an unknown type", { total: { type: "money" } }],
])("rejects %s", (_, fields) => {
	expect(fieldSpecs.safeParse(fields).success).toBe(false);
});
