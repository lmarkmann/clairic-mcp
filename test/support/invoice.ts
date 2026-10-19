import type { FieldSpec } from "../../src/clairic/fields";

// The exact state and fields the fixtures were recorded with.
export const invoiceState =
	"Invoice INV-2291 from Northwind Supply, issued 2026-09-02, net 30.\n4 pallets at $250.00 each, shipping $80.00.\nContact: Dana Ruiz, Priya Shah.";

export const invoiceFields: Record<string, FieldSpec> = {
	invoice_number: { type: "text" },
	due_date: {
		type: "date",
		instructions: "Issue date plus the net payment days",
	},
	total: {
		type: "number",
		decimals: 2,
		unit: "USD",
		instructions: "Amount due including shipping",
	},
	contacts: { type: "list", items: "text" },
	po_number: { type: "text", instructions: "Purchase order number" },
	days_to_pay: {
		type: "estimate",
		min: 0,
		max: 120,
		step: 1,
		instructions: "Days after issue until this invoice is paid",
	},
	payment_term: {
		type: "duration",
		unit: "days",
		integer: true,
		instructions: "Net payment term",
	},
};
