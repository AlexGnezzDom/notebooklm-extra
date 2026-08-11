#!/usr/bin/env node
/**
 * notebooklm-extra — MCP-сервер.
 * Дополняет notebooklm-mcp: чтение/выгрузка источников и артефакты Студии.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { TOOLS, handlers } from "./tools.mjs";

const server = new Server(
  { name: "notebooklm-extra", version: "1.0.0" },
  { capabilities: { tools: {} } }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { name, arguments: args } = req.params;
  const fn = handlers[name];
  if (!fn) {
    return {
      content: [
        { type: "text", text: JSON.stringify({ success: false, error: `Неизвестный инструмент: ${name}` }) },
      ],
      isError: true,
    };
  }
  try {
    const data = await fn(args || {});
    return {
      content: [{ type: "text", text: JSON.stringify({ success: true, data }, null, 2) }],
    };
  } catch (e) {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(
            { success: false, error: String(e?.message || e).slice(0, 800) },
            null,
            2
          ),
        },
      ],
      isError: true,
    };
  }
});

await server.connect(new StdioServerTransport());
