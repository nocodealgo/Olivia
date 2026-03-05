/**
 * Canvas WebSocket Server
 *
 * Upgrades HTTP connections on /canvas/ws to WebSocket.
 * Broadcasts widget updates to all connected clients.
 */

import { WebSocketServer, type WebSocket } from "ws";
import type { Server } from "node:http";
import { setBroadcast, getCanvasState, handleFormSubmission } from "./canvas-manager.js";
import type { ServerMessage, ClientMessage } from "./types.js";

const clients = new Set<WebSocket>();

export function attachCanvasWs(httpServer: Server): void {
    const wss = new WebSocketServer({ noServer: true });

    // Handle HTTP upgrade for /canvas/ws
    httpServer.on("upgrade", (req, socket, head) => {
        const url = new URL(req.url || "/", "http://localhost");
        if (url.pathname === "/canvas/ws") {
            // Auth check — require Bearer token or cookie when WEBHOOK_SECRET is set
            const secret = process.env.WEBHOOK_SECRET;
            if (secret) {
                const auth = req.headers.authorization;
                const cookie = req.headers.cookie?.match(/giorgio_token=([^;]+)/)?.[1];
                if (auth !== `Bearer ${secret}` && cookie !== secret) {
                    socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
                    socket.destroy();
                    return;
                }
            }
            wss.handleUpgrade(req, socket, head, (ws) => {
                wss.emit("connection", ws, req);
            });
        }
        // Other upgrade requests are ignored (handled elsewhere or dropped)
    });

    wss.on("connection", (ws) => {
        clients.add(ws);
        console.log(`  🎨 Canvas client connected (${clients.size} total)`);

        // Send current state on connect
        const state: ServerMessage = { type: "canvas:state", widgets: getCanvasState() };
        ws.send(JSON.stringify(state));

        ws.on("message", (raw) => {
            try {
                const msg = JSON.parse(raw.toString()) as ClientMessage;

                if (msg.type === "form:submit") {
                    handleFormSubmission(msg.callbackId, msg.data);
                }

                if (msg.type === "widget:action") {
                    console.log(`  🎨 Widget action: ${msg.widgetId} → ${msg.action}`);
                }
            } catch {
                // Ignore malformed messages
            }
        });

        ws.on("close", () => {
            clients.delete(ws);
            console.log(`  🎨 Canvas client disconnected (${clients.size} remaining)`);
        });
    });

    // Wire broadcast function
    setBroadcast((msg: ServerMessage) => {
        const data = JSON.stringify(msg);
        for (const client of clients) {
            if (client.readyState === client.OPEN) {
                client.send(data);
            }
        }
    });

    console.log("  🎨 Canvas WebSocket ready on /canvas/ws");
}

export function canvasClientCount(): number {
    return clients.size;
}
