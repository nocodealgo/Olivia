import { db } from "../memory/db.js";

// ── Schema ───────────────────────────────────────────

db.exec(`
  CREATE TABLE IF NOT EXISTS usage_log (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    model         TEXT    NOT NULL,
    input_tokens  INTEGER NOT NULL DEFAULT 0,
    output_tokens INTEGER NOT NULL DEFAULT 0,
    cost_usd      REAL    NOT NULL DEFAULT 0,
    latency_ms    INTEGER NOT NULL DEFAULT 0,
    purpose       TEXT    NOT NULL DEFAULT 'chat',
    created_at    TEXT    DEFAULT (datetime('now'))
  );
`);

// ── Pricing per 1M tokens ────────────────────────────

const PRICING: Record<string, { input: number; output: number }> = {
  "claude-sonnet-4-20250514": { input: 3.00, output: 15.00 },
  "claude-haiku-4-5-20251001": { input: 0.80, output: 4.00 },
  "text-embedding-3-small": { input: 0.02, output: 0 },
  "text-embedding-3-large": { input: 0.13, output: 0 },
  "whisper-large-v3-turbo": { input: 0.04, output: 0 },
};

function estimateCost(model: string, inputTokens: number, outputTokens: number): number {
  const prices = PRICING[model];
  if (!prices) return 0;
  return (inputTokens / 1_000_000) * prices.input + (outputTokens / 1_000_000) * prices.output;
}

// ── Prepared statements ──────────────────────────────

const insertStmt = db.prepare(`
  INSERT INTO usage_log (model, input_tokens, output_tokens, cost_usd, latency_ms, purpose)
  VALUES (?, ?, ?, ?, ?, ?)
`);

const todayStmt = db.prepare(`
  SELECT
    COUNT(*) as calls,
    COALESCE(SUM(input_tokens), 0) as input_tokens,
    COALESCE(SUM(output_tokens), 0) as output_tokens,
    COALESCE(SUM(cost_usd), 0) as cost_usd,
    COALESCE(AVG(latency_ms), 0) as avg_latency
  FROM usage_log
  WHERE date(created_at) = date('now')
`);

const allTimeStmt = db.prepare(`
  SELECT
    COUNT(*) as calls,
    COALESCE(SUM(input_tokens), 0) as input_tokens,
    COALESCE(SUM(output_tokens), 0) as output_tokens,
    COALESCE(SUM(cost_usd), 0) as cost_usd,
    COALESCE(AVG(latency_ms), 0) as avg_latency
  FROM usage_log
`);

const byModelStmt = db.prepare(`
  SELECT
    model,
    COUNT(*) as calls,
    COALESCE(SUM(input_tokens), 0) as input_tokens,
    COALESCE(SUM(output_tokens), 0) as output_tokens,
    COALESCE(SUM(cost_usd), 0) as cost_usd
  FROM usage_log
  GROUP BY model
  ORDER BY cost_usd DESC
`);

// ── Public API ───────────────────────────────────────

export interface UsageEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  latencyMs: number;
  purpose: string;
}

/**
 * Log an API call's usage.
 */
export function logUsage(
  model: string,
  inputTokens: number,
  outputTokens: number,
  latencyMs: number,
  purpose = "chat"
): void {
  const cost = estimateCost(model, inputTokens, outputTokens);
  insertStmt.run(model, inputTokens, outputTokens, cost, Math.round(latencyMs), purpose);
}

interface UsageSummary {
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
  avg_latency: number;
}

interface ModelBreakdown {
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cost_usd: number;
}

/**
 * Get formatted usage report for the /usage command.
 */
export function getUsageReport(): string {
  const today = todayStmt.get() as UsageSummary;
  const allTime = allTimeStmt.get() as UsageSummary;
  const byModel = byModelStmt.all() as ModelBreakdown[];

  const fmt = (n: number) => n.toLocaleString();
  const fmtCost = (n: number) => `$${n.toFixed(4)}`;
  const fmtLatency = (n: number) => `${Math.round(n)}ms`;

  let report = `📊 *Usage Report*\n\n`;

  report += `*Today*\n`;
  report += `  Calls: ${fmt(today.calls)}\n`;
  report += `  Tokens: ${fmt(today.input_tokens)} in / ${fmt(today.output_tokens)} out\n`;
  report += `  Cost: ${fmtCost(today.cost_usd)}\n`;
  report += `  Avg latency: ${fmtLatency(today.avg_latency)}\n\n`;

  report += `*All Time*\n`;
  report += `  Calls: ${fmt(allTime.calls)}\n`;
  report += `  Tokens: ${fmt(allTime.input_tokens)} in / ${fmt(allTime.output_tokens)} out\n`;
  report += `  Cost: ${fmtCost(allTime.cost_usd)}\n`;
  report += `  Avg latency: ${fmtLatency(allTime.avg_latency)}\n`;

  if (byModel.length > 0) {
    report += `\n*By Model*\n`;
    for (const m of byModel) {
      report += `  ${m.model}: ${fmt(m.calls)} calls, ${fmtCost(m.cost_usd)}\n`;
    }
  }

  return report;
}
