#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamable-http.js";
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
  // SSE mode - run playwright with --port and --host
  console.log("🌐 SSE Mode");
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
  // StreamableHTTP mode - run playwright via stdio and wrap with MCP SDK
  console.log("📡 StreamableHTTP Mode");
  console.log(`   URL: http://${HOST === "::" ? "localhost" : HOST}:${PORT}/mcp`);
  console.log("   Compatible with: LobeChat, Claude Desktop, etc.");
  console.log("==========================================");
  console.log("");
  
  // Start playwright process with stdio
  const playwright = spawn("npx", ["--silent", "@playwright/mcp", ...playwrightArgs], {
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      ...process.env,
      NPM_CONFIG_UPDATE_NOTIFIER: "false"
    }
  });
  
  playwright.on("error", (err) => {
    console.error("Failed to start playwright:", err);
    process.exit(1);
  });
  
  // Create MCP Server that proxies to playwright
  const server = new Server(
    {
      name: "playwright-mcp",
      version: "0.0.32",
    },
    {
      capabilities: {
        tools: {},
        prompts: {},
        resources: {},
      },
    }
  );
  
  // Connect to playwright via stdio
  const stdioTransport = new StdioServerTransport();
  
  // Create HTTP server with StreamableHTTP transport
  const httpServer = http.createServer(async (req, res) => {
    if (req.url === "/mcp" && req.method === "POST") {
      const transport = new StreamableHTTPServerTransport({
        req,
        res,
      });
      
      // Forward messages between HTTP client and playwright stdio
      try {
        // Read from HTTP request
        transport.onMessage((message) => {
          // Forward to playwright stdin
          if (playwright.stdin) {
            playwright.stdin.write(JSON.stringify(message) + "\n");
          }
        });
        
        // Read from playwright stdout and forward to HTTP response
        playwright.stdout.on("data", (data) => {
          try {
            const messages = data.toString().split("\n").filter(Boolean);
            messages.forEach((msg) => {
              try {
                const parsed = JSON.parse(msg);
                transport.send(parsed);
              } catch (e) {
                // Ignore parse errors for non-JSON output
              }
            });
          } catch (e) {
            console.error("Error processing playwright output:", e);
          }
        });
        
        await transport.start();
      } catch (error) {
        console.error("Transport error:", error);
        res.writeHead(500);
        res.end("Internal Server Error");
      }
    } else if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", mode: MODE }));
    } else {
      res.writeHead(404);
      res.end("Not Found");
    }
  });
  
  httpServer.listen(PORT, HOST, () => {
    console.log(`✅ Server listening on ${HOST}:${PORT}`);
    if (HOST === "::" || HOST === "0.0.0.0") {
      console.log(`   http://localhost:${PORT}/mcp`);
      console.log(`   http://127.0.0.1:${PORT}/mcp`);
      if (HOST === "::") {
        console.log(`   http://[::1]:${PORT}/mcp`);
      }
    }
  });
  
  // Cleanup on exit
  process.on("SIGTERM", () => {
    console.log("\nShutting down...");
    playwright.kill();
    httpServer.close();
    process.exit(0);
  });
  
  process.on("SIGINT", () => {
    console.log("\nShutting down...");
    playwright.kill();
    httpServer.close();
    process.exit(0);
  });
  
  playwright.on("exit", (code) => {
    console.log(`Playwright process exited with code ${code}`);
    httpServer.close();
    process.exit(code || 0);
  });
}
