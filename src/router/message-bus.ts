import type { Channel, ChannelAdapter, IncomingMessage } from "./types.js";
import { handleMessage } from "../agent.js";
import { startTyping } from "./typing.js";
import { parseCommand } from "./commands.js";

// ── Adapter registry ─────────────────────────────────

const adapters = new Map<Channel, ChannelAdapter>();

export function registerAdapter(channel: Channel, adapter: ChannelAdapter): void {
    adapters.set(channel, adapter);
    console.log(`  📡 Registered ${channel} adapter`);
}

// ── Central message routing ──────────────────────────

/**
 * Route an incoming message through the agent and back to the channel.
 * All messages from all channels flow through here.
 */
export async function routeMessage(msg: IncomingMessage): Promise<void> {
    const adapter = adapters.get(msg.channel);
    if (!adapter) {
        console.error(`  ❌ No adapter registered for channel: ${msg.channel}`);
        return;
    }

    // ── Log (clean — no sensitive data) ──
    const icon = msg.channel === "telegram" ? "💬" : msg.channel === "whatsapp" ? "📱" : "🌐";
    console.log(`${icon} [${msg.channel}] ${msg.senderName}: ${msg.text.slice(0, 100)}`);

    // ── Check for slash commands (handled before LLM) ──
    const cmdResult = await parseCommand(msg.text, msg.chatId);
    if (cmdResult.handled) {
        if (cmdResult.reply) {
            await adapter.send(msg.chatId, cmdResult.reply, msg.replyContext);
        }
        return;
    }

    // Start continuous typing indicator (repeats every 4s until stopped)
    const stopTyping = startTyping(adapter, msg.chatId, msg.replyContext);

    try {
        // Process through the agent
        const reply = await handleMessage(msg.chatId, msg.text);

        // Stop typing before sending reply
        stopTyping();

        // Send reply back through the same channel
        await adapter.send(msg.chatId, reply, msg.replyContext);
    } catch (err) {
        // Stop typing on error too
        stopTyping();

        console.error(`  ❌ [${msg.channel}] Error:`, err instanceof Error ? err.message : err);

        // Try to send error message back
        try {
            await adapter.send(
                msg.chatId,
                "Something went wrong. Check the logs for details.",
                msg.replyContext
            );
        } catch {
            // Can't even send error — silently fail
        }
    }
}
