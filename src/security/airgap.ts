/**
 * Air-gapped mode — complete offline operation.
 *
 * When AIRGAP_MODE=true:
 * - All LLM calls route to Ollama (local)
 * - External API calls are blocked
 * - No data leaves the machine
 * - Supabase sync disabled
 * - Web search disabled
 * - Only local memory (SQLite)
 */

// ── Config ───────────────────────────────────────────

export const AIRGAP_ENABLED = process.env.AIRGAP_MODE === "true";

// ── Public API ───────────────────────────────────────

/**
 * Check if air-gapped mode is active.
 */
export function isAirGapped(): boolean {
    return AIRGAP_ENABLED;
}

/**
 * Block an operation if air-gapped. Returns an error message or null if allowed.
 */
export function airGapCheck(operation: string): string | null {
    if (!AIRGAP_ENABLED) return null;
    return `🔒 Air-gapped mode: "${operation}" is disabled. All processing stays local.`;
}

/**
 * List what's disabled in air-gapped mode.
 */
export function getAirGapStatus(): string {
    if (!AIRGAP_ENABLED) return "Air-gapped mode: disabled (normal operation).";

    return [
        "✈️  Air-gapped mode: ACTIVE",
        "   ✅ LLM          → Ollama (local)",
        "   ✅ Memory        → SQLite (local)",
        "   ✅ File tools    → enabled",
        "   ✅ Shell exec    → enabled",
        "   ✅ Browser       → local only",
        "   ❌ Cloud LLMs    → blocked (OpenRouter, Anthropic, etc.)",
        "   ❌ Supabase sync → blocked",
        "   ❌ Web search    → blocked",
        "   ❌ Webhooks      → blocked",
        "   ❌ IP geolocation → blocked",
        "   ❌ Model refresh  → blocked",
    ].join("\n");
}

// ── Startup log ──────────────────────────────────────

if (AIRGAP_ENABLED) {
    console.log("  ✈️  AIR-GAPPED MODE — all traffic stays local.");
}
