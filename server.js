#!/usr/bin/env node
import { spawn } from "child_process";
import http from "http";

const PORT = parseInt(process.env.MCP_PORT || "8931");
const HOST = process.env.MCP_HOST || "::";
const MODE = process.env.MCP_MODE || "http";

console.log("==========================================");
console.log("🎭 Playwright MCP Server");
console.log("==========================================");

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
  // StreamableHTTP mode - Simple HTTP to stdio bridge
  console.log("📡 StreamableHTTP Mode (Direct Proxy)");
  console.log(`   URL: http://${HOST === "::" ? "localhost" : HOST}:${PORT}/mcp`);
  console.log("   Compatible with: LobeChat, Claude Desktop, etc.");
  console.log("==========================================");
  console.log("");
  
  // Start playwright process - we'll communicate directly via stdin/stdout
  const playwrightProcess = spawn("npx", ["--silent", "@playwright/mcp", ...playwrightArgs], {
    stdio: ["pipe", "pipe", "inherit"],
    env: {
      ...process.env,
      NPM_CONFIG_UPDATE_NOTIFIER: "false"
    }
  });
  
  playwrightProcess.on("error", (err) => {
    console.error("Failed to start playwright:", err);
    process.exit(1);
  });
  
  playwrightProcess.on("exit", (code) => {
    console.log(`Playwright process exited with code ${code}`);
    process.exit(code || 0);
  });
  
  // Track pending requests
  const pendingRequests = new Map();
  let requestIdCounter = 0;
  
  // Handle responses from playwright
  let buffer = "";
  playwrightProcess.stdout.on("data", (data) => {
    buffer += data.toString();
    const lines = buffer.split("\n");
    buffer = lines.pop() || ""; // Keep incomplete line in buffer
    
    for (const line of lines) {
      if (!line.trim()) continue;
      
      try {
        const response = JSON.parse(line);
        if (response.id !== undefined && pendingRequests.has(response.id)) {
          const { resolve } = pendingRequests.get(response.id);
          pendingRequests.delete(response.id);
          resolve(response);
        }
      } catch (e) {
        console.error("Failed to parse playwright response:", line);
      }
    }
  });
  
  // Function to send request to playwright and wait for response
  const sendToPlaywright = (message) => {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        pendingRequests.delete(message.id);
        reject(new Error("Request timeout"));
      }, 30000);
      
      pendingRequests.set(message.id, {
        resolve: (response) => {
          clearTimeout(timeout);
          resolve(response);
        },
        reject
      });
      
      playwrightProcess.stdin.write(JSON.stringify(message) + "\n");
    });
  };
  
  console.log("✅ Playwright MCP process started");
  console.log("   Direct stdio proxy mode (no SDK wrapping)");
  
  // Create HTTP server - simple JSON-RPC proxy
  const httpServer = http.createServer(async (req, res) => {
    // Enable CORS
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
    
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
    
    // MCP endpoint - direct JSON-RPC proxy
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
        // Assign ID if not present
        if (parsedBody.id === undefined) {
          parsedBody.id = ++requestIdCounter;
        }
        
        // Forward to playwright and wait for response
        const response = await sendToPlaywright(parsedBody);
        
        // Send response back to client
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(response));
      } catch (error) {
        console.error("Error proxying MCP request:", error);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: error.message || "Internal server error" },
            id: parsedBody.id || null
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
    if (playwrightProcess && !playwrightProcess.killed) {
      playwrightProcess.kill();
    }
    httpServer.close();
    process.exit(0);
  };
  
  process.on("SIGTERM", cleanup);
  process.on("SIGINT", cleanup);
}
