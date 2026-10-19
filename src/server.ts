import { McpServer } from "@modelcontextprotocol/server";

import { version } from "../package.json";
import { registerExtractTools } from "./tools/extract";

export function createServer(): McpServer {
	const server = new McpServer({ name: "clairic-mcp", version });
	registerExtractTools(server);
	return server;
}
