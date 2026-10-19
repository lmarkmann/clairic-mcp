import { createMcpHandler } from "@modelcontextprotocol/server";

import { isAccessVerified } from "./auth";
import { createServer } from "./server";

const mcp = createMcpHandler(createServer);

export default {
	async fetch(request, env) {
		if (new URL(request.url).pathname !== "/mcp") return new Response("Not found", { status: 404 });
		if (env.DEV_SKIP_AUTH !== "1" && !(await isAccessVerified(request, env))) {
			return new Response("Unauthorized", { status: 401 });
		}
		return mcp.fetch(request);
	},
} satisfies ExportedHandler<Env>;
