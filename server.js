#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { spawn } from "child_process";
import http from "http";

const PORT = parseInt(process.env.MCP_PORT || "8931");
const HOST = process.env.MCP_HOST || "::";
const MODE = process.env.MCP_MODE || "http";

console.log("==========================================");
console.log("🎭 Playwright MCP Server");
console.log("==========================================");
console.log(`Mode: ${MODE}`);
console.log(`Host: ${HOST}`);
console.log(`Port: ${PORT}`);
console.log("");

// Build playwright command arguments
const playwrightArgs = [];

if (process.env.HEADLESS === "true") {
  playwrightArgs.push("--headless");
}

if (process.env.ISOLATED === "true") {
  playwrightArgs.push("--isolated");
}

if (process.env.NOSANDBOX === "true") {
  playwrightArgs.push("--no-sandbox");
}

if (process.env.VIEWPORT_SIZE) {
  playwrightArgs.push("--viewport-size", process.env.VIEWPORT_SIZE);
}

console.log(`Playwright args: ${playwrightArgs.join(" ")}`);
console.log("");

if (MODE === "sse") {
  // SSE mode - run playwright with --port and --host directly
  console.log("🌐 SSE Mode (Native Playwright)");
  console.log(`   URL: http://${HOST === "::" ? "localhost" : HOST}:${PORT}/sse`);
  console.log("==========================================");
  console.log("");
  
  const args = [...playwrightArgs, "--port", PORT.toString(), "--host", HOST];
  const playwright = spawn("npx", ["--silent", "@playwright/mcp", ...args], {
    stdio: "inherit",
    env: {
      ...process.env,
      NPM_CONFIG_UPDATE_NOTIFIER: "false"
    }
  });
  
  playwright.on("error", (err) => {
    console.error("Failed to start playwright:", err);
    process.exit(1);
  });
  
  playwright.on("exit", (code) => {
    process.exit(code || 0);
  });
} else {
  // StreamableHTTP mode - create proxy server following MCP SDK patterns
  console.log("📡 StreamableHTTP Mode (Stateless)");
  console.log(`   URL: http://${HOST === "::" ? "localhost" : HOST}:${PORT}/mcp`);
  console.log("   Compatible with: LobeChat, Claude Desktop, etc.");
  console.log("==========================================");
  console.log("");
  
  // Create a client to connect to playwright via stdio
  const playwrightClient = new Client({
    name: "playwright-http-bridge",
    version: "1.0.0"
  }, {
    capabilities: {}
  });
  
  const stdioTransport = new StdioClientTransport({
    command: "npx",
    args: ["--silent", "@playwright/mcp", ...playwrightArgs],
    env: {
      ...process.env,
      NPM_CONFIG_UPDATE_NOTIFIER: "false"
    }
  });
  
  // Connect the client to playwright
  await playwrightClient.connect(stdioTransport);
  console.log("✅ Connected to Playwright MCP via stdio");
  
  // Get playwright's capabilities
  const playwrightInfo = await playwrightClient.getServerVersion();
  console.log(`   Playwright MCP: ${playwrightInfo.name} v${playwrightInfo.version}`);
  
  // Create an MCP proxy server that forwards requests to playwright client
  const proxyServer = new McpServer({
    name: playwrightInfo.name || "playwright-mcp",
    version: playwrightInfo.version || "1.0.0"
  }, {
    capabilities: playwrightInfo.capabilities || {}
  });
  
  // List and register all tools from playwright
  const tools = await playwrightClient.listTools();
  console.log(`   Registered ${tools.tools.length} tools from Playwright`);
  
  for (const tool of tools.tools) {
    proxyServer.registerTool(
      tool.name,
      {
        title: tool.title || tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema || {}
      },
      async (args) => {
        // Forward tool calls to playwright client
        const result = await playwrightClient.callTool({
          name: tool.name,
          arguments: args
        });
        return result;
      }
    );
  }
  
  // Create HTTP server (using plain Node.js http, as recommended)
  const httpServer = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    
    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }
    
    // Health check
    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", mode: MODE }));
      return;
    }
    
    // MCP endpoint
    if (req.url === "/mcp" && req.method === "POST") {
      // Read body
      let body = "";
      for await (const chunk of req) {
        body += chunk;
      }
      
      let parsedBody;
      try {
        parsedBody = JSON.parse(body);
      } catch (error) {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32700, message: "Parse error" },
          id: null
        }));
        return;
      }
      
      try {
        // Create stateless transport (new for each request, as recommended)
        const transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: undefined, // Stateless
          enableJsonResponse: true // JSON response instead of SSE
        });
        
        res.on("close", () => {
          transport.close();
        });
        
        // Connect proxy server to transport
        await proxyServer.connect(transport);
        
        // Handle the request
        await transport.handleRequest(req, res, parsedBody);
      } catch (error) {
        console.error("Error handling MCP request:", error);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal server error" },
            id: null
          }));
        }
      }
    } else {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("Not Found");
    }
  });
  
  httpServer.listen(PORT, HOST, () => {
    console.log(`✅ HTTP Server listening on ${HOST}:${PORT}`);
    if (HOST === "::" || HOST === "0.0.0.0") {
      console.log(`   http://localhost:${PORT}/mcp`);
      console.log(`   http://127.0.0.1:${PORT}/mcp`);
      if (HOST === "::") {
        console.log(`   http://[::1]:${PORT}/mcp`);
      }
    }
    console.log("");
    console.log("✅ Ready to accept MCP requests");
  });
  
  // Cleanup
  const cleanup = () => {
    console.log("\nShutting down...");
    playwrightClient.close().catch(console.error);
    httpServer.close();
    process.exit(0);
  };
  
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}
