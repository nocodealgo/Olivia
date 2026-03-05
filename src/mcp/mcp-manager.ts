import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { registerTool, type ToolHandler } from "../tools/registry.js";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

// ── Types ────────────────────────────────────────────

interface McpStdioConfig {
    /** Command to launch the MCP server */
    command: string;
    args?: string[];
    env?: Record<string, string>;
}

interface McpSseConfig {
    /** SSE endpoint URL for remote MCP servers */
    url: string;
    /** Optional API key sent as Bearer token */
    apiKey?: string;
}

type McpServerConfig = McpStdioConfig | McpSseConfig;

interface McpConfig {
    mcpServers: Record<string, McpServerConfig>;
}

interface McpConnection {
    name: string;
    client: Client;
    transport: StdioClientTransport | SSEClientTransport;
    toolCount: number;
}

function isStdioConfig(c: McpServerConfig): c is McpStdioConfig {
    return "command" in c;
}

function isSseConfig(c: McpServerConfig): c is McpSseConfig {
    return "url" in c;
}

// ── State ────────────────────────────────────────────

const connections: McpConnection[] = [];

// ── Public API ───────────────────────────────────────

/**
 * Load mcp.json config and connect to all configured MCP servers.
 * Supports both stdio (local processes) and SSE (remote HTTP) transports.
 * Discovers their tools and registers them in the tool registry.
 */
export async function initMcp(): Promise<void> {
    const configPath = resolve("mcp.json");
    let config: McpConfig;

    try {
        const raw = await readFile(configPath, "utf-8");
        config = JSON.parse(raw) as McpConfig;
    } catch {
        console.log("  ℹ️  No mcp.json found — MCP bridge disabled.");
        return;
    }

    const serverEntries = Object.entries(config.mcpServers || {});
    if (serverEntries.length === 0) {
        console.log("  ℹ️  mcp.json has no servers configured.");
        return;
    }

    for (const [name, serverConfig] of serverEntries) {
        try {
            await connectServer(name, serverConfig);
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  ❌ MCP server "${name}" failed to connect: ${msg}`);
        }
    }
}

/**
 * Shut down all MCP connections gracefully.
 */
export async function shutdownMcp(): Promise<void> {
    for (const conn of connections) {
        try {
            await conn.client.close();
            console.log(`  🔌 MCP server "${conn.name}" disconnected.`);
        } catch {
            // Ignore shutdown errors
        }
    }
    connections.length = 0;
}

/**
 * Get a summary of all MCP connections and their tools.
 */
export function getMcpStatus(): Array<{ name: string; toolCount: number; connected: boolean }> {
    return connections.map((c) => ({
        name: c.name,
        toolCount: c.toolCount,
        connected: true,
    }));
}

// ── Internal ─────────────────────────────────────────

async function connectServer(
    name: string,
    serverConfig: McpServerConfig
): Promise<void> {
    let transport: StdioClientTransport | SSEClientTransport;

    if (isStdioConfig(serverConfig)) {
        // Local process via stdio
        transport = new StdioClientTransport({
            command: serverConfig.command,
            args: serverConfig.args,
            env: { ...process.env, ...(serverConfig.env || {}) } as Record<string, string>,
        });
    } else if (isSseConfig(serverConfig)) {
        // Remote server via SSE
        const headers: Record<string, string> = {};
        if (serverConfig.apiKey) {
            headers["Authorization"] = `Bearer ${serverConfig.apiKey}`;
        }
        transport = new SSEClientTransport(new URL(serverConfig.url), {
            requestInit: { headers },
        });
    } else {
        console.error(`  ❌ MCP "${name}": invalid config — needs 'command' (stdio) or 'url' (SSE).`);
        return;
    }

    const client = new Client({
        name: "giorgio",
        version: "1.0.0",
    });

    await client.connect(transport);

    // Discover tools
    const toolsResult = await client.listTools();
    const tools = toolsResult.tools || [];

    if (tools.length === 0) {
        console.log(`  🔌 MCP "${name}" connected (no tools exposed).`);
        connections.push({ name, client, transport, toolCount: 0 });
        return;
    }

    // Register each MCP tool in our registry
    for (const mcpTool of tools) {
        const toolName = `mcp_${name}_${mcpTool.name}`;

        const handler: ToolHandler = {
            definition: {
                name: toolName,
                description: `[MCP: ${name}] ${mcpTool.description || mcpTool.name}`,
                input_schema: {
                    type: "object" as const,
                    ...(mcpTool.inputSchema as Record<string, unknown>),
                },
            },
            async execute(input: Record<string, unknown>): Promise<string> {
                const result = await client.callTool({
                    name: mcpTool.name,
                    arguments: input,
                });

                // MCP tool results have a `content` array
                const contentParts = result.content as Array<{
                    type: string;
                    text?: string;
                }>;

                const textParts = contentParts
                    .filter((c) => c.type === "text" && c.text)
                    .map((c) => c.text!);

                return textParts.join("\n") || JSON.stringify(result.content);
            },
        };

        registerTool(handler);
    }

    connections.push({ name, client, transport, toolCount: tools.length });

    const transportType = isStdioConfig(serverConfig) ? "stdio" : "SSE";
    console.log(
        `  🔌 MCP "${name}" connected [${transportType}] — ${tools.length} tool(s): ${tools.map((t) => t.name).join(", ")}`
    );
}
