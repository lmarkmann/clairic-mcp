import { expect, test } from "vitest";

import { serverWaitMs } from "../src/lib/http";

const now = Date.UTC(2026, 9, 19);

test.each([
	[{ "retry-after": "5" }, 5_000],
	[{ "retry-after": new Date(now + 7_000).toUTCString() }, 7_000],
	[{ "x-ratelimit-reset": String(now / 1000 + 30) }, 30_000],
	[{ "x-ratelimit-reset": "60" }, 60_000],
	[{}, undefined],
])("waits as %j asks", (headers, wait) => {
	expect(serverWaitMs(new Headers(headers), now)).toBe(wait);
});
