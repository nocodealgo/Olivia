/**
 * Plugin Registry — manages registration, lookup, and swapping of trait implementations.
 *
 * Active implementations are selected via env vars:
 * - PLUGIN_PROVIDER=anthropic (default)
 * - PLUGIN_CHANNEL=telegram (default)
 * - PLUGIN_MEMORY=sqlite (default)
 */

import type {
    ProviderTrait,
    ChannelTrait,
    ToolTrait,
    MemoryTrait,
    PluginMetadata,
} from "./traits.js";

// ── Storage ──────────────────────────────────────────

const providers = new Map<string, ProviderTrait>();
const channels = new Map<string, ChannelTrait>();
const toolPlugins = new Map<string, ToolTrait>();
const memoryBackends = new Map<string, MemoryTrait>();
const plugins: PluginMetadata[] = [];

// ── Config ───────────────────────────────────────────

const ACTIVE_PROVIDER = process.env.PLUGIN_PROVIDER || "anthropic";
const ACTIVE_MEMORY = process.env.PLUGIN_MEMORY || "sqlite";

// ── Registration ─────────────────────────────────────

export function registerProvider(provider: ProviderTrait): void {
    providers.set(provider.id, provider);
    console.log(`  🔌 Plugin: provider "${provider.name}" registered.`);
}

export function registerChannel(channel: ChannelTrait): void {
    channels.set(channel.id, channel);
    console.log(`  🔌 Plugin: channel "${channel.name}" registered.`);
}

export function registerToolPlugin(tool: ToolTrait): void {
    toolPlugins.set(tool.id, tool);
}

export function registerMemory(memory: MemoryTrait): void {
    memoryBackends.set(memory.id, memory);
    console.log(`  🔌 Plugin: memory "${memory.name}" registered.`);
}

/**
 * Register a full plugin (provides multiple traits).
 */
export function registerPlugin(meta: PluginMetadata): void {
    plugins.push(meta);
    console.log(`  📦 Plugin: "${meta.name}" v${meta.version} — ${meta.description}`);

    if (meta.provides.providers) {
        for (const p of meta.provides.providers) registerProvider(p);
    }
    if (meta.provides.channels) {
        for (const c of meta.provides.channels) registerChannel(c);
    }
    if (meta.provides.tools) {
        for (const t of meta.provides.tools) registerToolPlugin(t);
    }
    if (meta.provides.memory) {
        for (const m of meta.provides.memory) registerMemory(m);
    }
}

// ── Lookup (active implementation) ───────────────────

/** Get the active LLM provider (based on PLUGIN_PROVIDER env) */
export function getProvider(id?: string): ProviderTrait | undefined {
    return providers.get(id || ACTIVE_PROVIDER);
}

/** Get all registered providers */
export function getAllProviders(): ProviderTrait[] {
    return Array.from(providers.values());
}

/** Get a specific channel */
export function getChannel(id: string): ChannelTrait | undefined {
    return channels.get(id);
}

/** Get all registered channels */
export function getAllChannels(): ChannelTrait[] {
    return Array.from(channels.values());
}

/** Get a specific tool plugin */
export function getToolPlugin(id: string): ToolTrait | undefined {
    return toolPlugins.get(id);
}

/** Get all registered tool plugins */
export function getAllToolPlugins(): ToolTrait[] {
    return Array.from(toolPlugins.values());
}

/** Get the active memory backend (based on PLUGIN_MEMORY env) */
export function getMemory(id?: string): MemoryTrait | undefined {
    return memoryBackends.get(id || ACTIVE_MEMORY);
}

/** Get all registered memory backends */
export function getAllMemoryBackends(): MemoryTrait[] {
    return Array.from(memoryBackends.values());
}

// ── Swap at runtime ──────────────────────────────────

/**
 * Swap the active provider at runtime.
 */
export function swapProvider(id: string): ProviderTrait | undefined {
    const p = providers.get(id);
    if (p) {
        process.env.PLUGIN_PROVIDER = id;
        console.log(`  🔄 Provider swapped to: ${p.name}`);
    }
    return p;
}

/**
 * Swap the active memory backend at runtime.
 */
export function swapMemory(id: string): MemoryTrait | undefined {
    const m = memoryBackends.get(id);
    if (m) {
        process.env.PLUGIN_MEMORY = id;
        console.log(`  🔄 Memory backend swapped to: ${m.name}`);
    }
    return m;
}

// ── Status ───────────────────────────────────────────

export function getPluginStatus(): string {
    return [
        `📦 Plugin System:`,
        `   Providers: ${providers.size} registered (active: ${ACTIVE_PROVIDER})`,
        `   Channels : ${channels.size} registered`,
        `   Tools    : ${toolPlugins.size} registered`,
        `   Memory   : ${memoryBackends.size} registered (active: ${ACTIVE_MEMORY})`,
        `   Plugins  : ${plugins.map((p) => p.name).join(", ") || "none"}`,
    ].join("\n");
}

/**
 * Get full registry summary (for debugging).
 */
export function getRegistrySummary(): {
    providers: string[];
    channels: string[];
    tools: string[];
    memory: string[];
    activeProvider: string;
    activeMemory: string;
} {
    return {
        providers: Array.from(providers.keys()),
        channels: Array.from(channels.keys()),
        tools: Array.from(toolPlugins.keys()),
        memory: Array.from(memoryBackends.keys()),
        activeProvider: ACTIVE_PROVIDER,
        activeMemory: ACTIVE_MEMORY,
    };
}
