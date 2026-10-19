import { createMcpHandler } from "@modelcontextprotocol/server";

import { isAccessVerified } from "./auth";
import { createServer } from "./server";

const mcp = createMcpHandler(createServer);

export default {
	async fetch(request, env) {
		if (new URL(request.url).pathname !== "/mcp") return new Response("Not found", { status: 404 });
		// DEV_SKIP_AUTH comes only from .dev.vars, so Env declares it only where that file exists.
		const skipAuth = "DEV_SKIP_AUTH" in env && env.DEV_SKIP_AUTH === "1";
		if (!skipAuth && !(await isAccessVerified(request, env))) {
			return new Response("Unauthorized", { status: 401 });
		}
		return mcp.fetch(request);
	},
} satisfies ExportedHandler<Env>;
