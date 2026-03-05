/**
 * Soul Wizard — Guided soul.md creation
 *
 * A multi-step wizard that walks the user through defining their agent's
 * personality. Runs automatically on first install (no soul.md found),
 * then only via /soul command.
 *
 * State machine with 6 phases → generates and writes soul.md.
 */

import { writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

// ── Types ────────────────────────────────────────────

export interface WizardSession {
    phase: number;           // 0-6 (0 = not started, 6 = preview)
    awaitingCustom: boolean; // waiting for free-text custom answer
    answers: {
        name: string;
        role: string;
        personality: string;
        thinking: string;
        communication: string;
        workStyle: string;
    };
}

interface PhaseConfig {
    question: string;
    field: keyof WizardSession["answers"];
    options: { label: string; value: string }[];
}

// ── Wizard state (per chat) ──────────────────────────

const sessions = new Map<number, WizardSession>();

export function getWizardSession(chatId: number): WizardSession | undefined {
    return sessions.get(chatId);
}

export function isWizardActive(chatId: number): boolean {
    return sessions.has(chatId);
}

export function startWizard(chatId: number): WizardSession {
    const session: WizardSession = {
        phase: 1,
        awaitingCustom: false,
        answers: { name: "", role: "", personality: "", thinking: "", communication: "", workStyle: "" },
    };
    sessions.set(chatId, session);
    return session;
}

export function cancelWizard(chatId: number): void {
    sessions.delete(chatId);
}

// ── Phase definitions ────────────────────────────────

const PHASES: PhaseConfig[] = [
    {
        question: "🎭 *Let's build my personality.*\n\n*Step 1/6 — Name*\n\nWhat should I call myself?\n\n_Type a name or pick one:_",
        field: "name",
        options: [
            { label: "Giorgio", value: "Giorgio" },
            { label: "Atlas", value: "Atlas" },
            { label: "Nova", value: "Nova" },
            { label: "✏️ Custom", value: "__custom__" },
        ],
    },
    {
        question: "🎯 *Step 2/6 — Role*\n\nWhat's my primary role?",
        field: "role",
        options: [
            { label: "🧠 Thinking Partner", value: "a thinking partner who challenges ideas, asks sharp questions, and helps reason through problems" },
            { label: "💻 Code Assistant", value: "a hands-on coding assistant focused on writing, reviewing, and improving code" },
            { label: "📋 Personal Assistant", value: "a personal assistant who manages tasks, reminders, schedules, and daily life" },
            { label: "🌐 Research Analyst", value: "a research analyst who digs deep into topics, summarizes findings, and connects dots" },
            { label: "✏️ Custom", value: "__custom__" },
        ],
    },
    {
        question: "✨ *Step 3/6 — Personality*\n\nHow should I come across?",
        field: "personality",
        options: [
            { label: "😊 Casual & Warm", value: "casual, warm, and approachable — like talking to a smart friend" },
            { label: "🎯 Direct & Focused", value: "direct and focused — no fluff, straight to the point" },
            { label: "😄 Playful & Witty", value: "playful and witty — humor makes everything better" },
            { label: "👔 Professional", value: "professional and polished — clear, structured, authoritative" },
            { label: "✏️ Custom", value: "__custom__" },
        ],
    },
    {
        question: "💭 *Step 4/6 — Thinking Style*\n\nHow should I approach problems?",
        field: "thinking",
        options: [
            { label: "🏛️ Socratic", value: "Ask questions that sharpen thinking. Challenge assumptions. Guide rather than hand-feed answers" },
            { label: "🔮 Proactive", value: "Think ahead, flag risks before they happen, and suggest improvements without being asked" },
            { label: "🎯 Just Answer", value: "Give direct answers with minimal back-and-forth. Be efficient, not philosophical" },
            { label: "⚖️ Balanced", value: "Mix of asking good questions and providing direct answers, adapting to the situation" },
            { label: "✏️ Custom", value: "__custom__" },
        ],
    },
    {
        question: "🗣️ *Step 5/6 — Communication*\n\nHow should I talk?",
        field: "communication",
        options: [
            { label: "🪞 Mirror Your Energy", value: "Mirror the energy you get. Casual gets casual. Focused gets focused" },
            { label: "😎 Always Casual", value: "Keep it casual and relaxed at all times. Skip formalities" },
            { label: "📝 Always Clear & Structured", value: "Use clear structure, headers, and bullet points. Organize everything" },
            { label: "🌍 Bilingual", value: "Respond in whatever language the user writes in. Seamlessly switch" },
            { label: "✏️ Custom", value: "__custom__" },
        ],
    },
    {
        question: "⚙️ *Step 6/6 — Work Style*\n\nHow should I work with you?",
        field: "workStyle",
        options: [
            { label: "📋 Plan First", value: "Always plan first, get agreement, then execute step by step with checkpoints" },
            { label: "⚡ Just Do It", value: "Skip the planning talk — just do the work and show results" },
            { label: "🤝 Ask Each Time", value: "Check in at each decision point — don't assume, always ask" },
            { label: "🧩 Autonomous", value: "Work independently, make judgment calls, only ask when truly stuck" },
            { label: "✏️ Custom", value: "__custom__" },
        ],
    },
];

// ── Phase navigation ─────────────────────────────────

export function getCurrentPhase(session: WizardSession): PhaseConfig | null {
    if (session.phase < 1 || session.phase > PHASES.length) return null;
    return PHASES[session.phase - 1];
}

export function setAnswer(session: WizardSession, value: string): void {
    const phase = PHASES[session.phase - 1];
    if (phase) {
        (session.answers as any)[phase.field] = value;
        session.awaitingCustom = false;
        session.phase++;
    }
}

export function handleCustomRequest(session: WizardSession): void {
    session.awaitingCustom = true;
}

export function isComplete(session: WizardSession): boolean {
    return session.phase > PHASES.length;
}

// ── Generate soul.md ─────────────────────────────────

export function generateSoulMarkdown(answers: WizardSession["answers"]): string {
    return `# Soul

You're ${answers.name} — not a generic assistant. You're ${answers.role}.

## How you think

- ${answers.thinking}
- When you're unsure, say so honestly. Don't guess with confidence you don't have.
- Look around corners — think two steps ahead and flag issues before they become problems.

## How you talk

- ${answers.personality}
- ${answers.communication}
- Skip the corporate voice. No "I'd be happy to assist you with that." Just talk.
- Be direct. Say what you mean. If something's a bad idea, say so — respectfully, but clearly.
- Keep it tight. Don't over-explain when a sentence will do.

## How you work

- ${answers.workStyle}
- Own your mistakes. If something breaks, acknowledge it and fix it.
- Be proactive — if you see something that could be improved, flag it.
`;
}

// ── Preview text ─────────────────────────────────────

export function generatePreview(answers: WizardSession["answers"]): string {
    return [
        `🎭 *Soul Preview*\n`,
        `*Name:* ${answers.name}`,
        `*Role:* ${answers.role}`,
        `*Personality:* ${answers.personality}`,
        `*Thinking:* ${answers.thinking}`,
        `*Communication:* ${answers.communication}`,
        `*Work style:* ${answers.workStyle}`,
        `\n_Tap Save to write soul.md, or Edit to change a section._`,
    ].join("\n");
}

// ── File operations ──────────────────────────────────

const SOUL_PATH = resolve(process.cwd(), "soul.md");

export function saveSoul(answers: WizardSession["answers"]): void {
    const content = generateSoulMarkdown(answers);
    writeFileSync(SOUL_PATH, content, "utf-8");
}

export function soulExists(): boolean {
    return existsSync(SOUL_PATH);
}

export function getSoulContent(): string {
    try { return readFileSync(SOUL_PATH, "utf-8"); } catch { return ""; }
}

// ── Soul proposals (agent suggests, human approves) ──

interface SoulProposal {
    id: string;
    chatId: number;
    currentSoul: string;
    proposedSoul: string;
    explanation: string;
    timestamp: number;
}

const pendingProposals = new Map<string, SoulProposal>();
const PROPOSAL_EXPIRY_MS = 60 * 60 * 1000; // 1 hour

/**
 * Agent proposes a personality change. Returns the proposal ID
 * and the formatted message to send to the user.
 */
export function proposeSoulChange(
    chatId: number,
    proposedSoul: string,
    explanation: string,
): { id: string; message: string } {
    // Clean expired proposals
    const now = Date.now();
    for (const [id, p] of pendingProposals) {
        if (now - p.timestamp > PROPOSAL_EXPIRY_MS) pendingProposals.delete(id);
    }

    const id = `sp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const currentSoul = getSoulContent();

    pendingProposals.set(id, {
        id,
        chatId,
        currentSoul,
        proposedSoul,
        explanation,
        timestamp: now,
    });

    // Build a readable diff summary
    const currentLines = currentSoul.split("\n").filter(l => l.trim());
    const proposedLines = proposedSoul.split("\n").filter(l => l.trim());
    const added = proposedLines.filter(l => !currentLines.includes(l));
    const removed = currentLines.filter(l => !proposedLines.includes(l));

    const diffParts: string[] = [];
    if (removed.length > 0) diffParts.push(`🔴 *Removing:*\n${removed.map(l => `  - ${l}`).join("\n")}`);
    if (added.length > 0) diffParts.push(`🟢 *Adding:*\n${added.map(l => `  + ${l}`).join("\n")}`);
    const diffText = diffParts.length > 0 ? diffParts.join("\n\n") : "_No visible changes._";

    const message = [
        `🎭 *Soul Change Proposal*\n`,
        `📋 *What changes:*\n${diffText}\n`,
        `💡 *Why:*\n${explanation}\n`,
        `⚠️ *Implications:*`,
        `This will change how I think, talk, or work with you. The change takes effect on my next restart. Your current soul.md will be overwritten.\n`,
        `_This proposal expires in 1 hour._`,
    ].join("\n");

    return { id, message };
}

/**
 * Apply a pending soul proposal. Returns true if applied.
 */
export function applySoulProposal(proposalId: string): { applied: boolean; reason?: string } {
    const proposal = pendingProposals.get(proposalId);
    if (!proposal) return { applied: false, reason: "Proposal not found or expired." };

    if (Date.now() - proposal.timestamp > PROPOSAL_EXPIRY_MS) {
        pendingProposals.delete(proposalId);
        return { applied: false, reason: "Proposal has expired." };
    }

    try {
        writeFileSync(SOUL_PATH, proposal.proposedSoul, "utf-8");
        pendingProposals.delete(proposalId);
        return { applied: true };
    } catch (err) {
        return { applied: false, reason: `Write failed: ${err instanceof Error ? err.message : err}` };
    }
}

/**
 * Reject a pending soul proposal.
 */
export function rejectSoulProposal(proposalId: string): boolean {
    return pendingProposals.delete(proposalId);
}

/**
 * Get a pending proposal by ID.
 */
export function getPendingProposal(proposalId: string): SoulProposal | undefined {
    return pendingProposals.get(proposalId);
}

