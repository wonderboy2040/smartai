import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import { WebSocketServer, WebSocket } from "ws";

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Vite middleware for development
  let vite: any;
  if (process.env.NODE_ENV !== "production") {
    vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  const server = app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });

  // WebSocket Server
  const wss = new WebSocketServer({ server });
  const finnhubApiKey = process.env.FINNHUB_API_KEY;

  if (!finnhubApiKey) {
    console.error("FINNHUB_API_KEY not configured");
  } else {
    const connectFinnhub = () => {
      const finnhubSocket = new WebSocket(`wss://ws.finnhub.io?token=${finnhubApiKey}`);

      finnhubSocket.on("open", () => {
        console.log("Connected to Finnhub");
      });

      finnhubSocket.on("message", (data) => {
        // Broadcast to all connected clients
        wss.clients.forEach((client) => {
          if (client.readyState === WebSocket.OPEN) {
            client.send(data.toString());
          }
        });
      });

      finnhubSocket.on("close", () => {
        console.log("Finnhub disconnected, reconnecting in 5s...");
        setTimeout(connectFinnhub, 5000);
      });

      finnhubSocket.on("error", (err) => {
        console.error("Finnhub error:", err);
        finnhubSocket.close();
      });
      
      return finnhubSocket;
    };

    let finnhubSocket = connectFinnhub();

    wss.on("connection", (ws) => {
      ws.on("message", (message) => {
        const parsed = JSON.parse(message.toString());
        if (parsed.type === "subscribe") {
          finnhubSocket.send(JSON.stringify({ type: "subscribe", symbol: parsed.symbol }));
        } else if (parsed.type === "unsubscribe") {
          finnhubSocket.send(JSON.stringify({ type: "unsubscribe", symbol: parsed.symbol }));
        }
      });
    });
  }
}

startServer();
