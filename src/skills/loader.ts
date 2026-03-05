import { readdir, readFile, stat } from "node:fs/promises";
import { join, basename } from "node:path";

// ── Types ────────────────────────────────────────────

export interface Skill {
    /** Filename without extension */
    name: string;
    /** Skill title from frontmatter or first heading */
    title: string;
    /** Short description from frontmatter */
    description: string;
    /** Trigger keywords/phrases */
    triggers: string[];
    /** Full markdown content (instructions) */
    content: string;
    /** Whether this skill is active */
    enabled: boolean;
}

// ── State ────────────────────────────────────────────

const skills: Skill[] = [];

// ── Public API ───────────────────────────────────────

/**
 * Load all skill markdown files from the skills directory.
 * Each .md file defines a skill with optional YAML-like frontmatter.
 */
export async function loadSkills(skillsDir: string): Promise<void> {
    try {
        const s = await stat(skillsDir);
        if (!s.isDirectory()) return;
    } catch {
        console.log("  ℹ️  No /skills directory — skill system inactive.");
        return;
    }

    const files = await readdir(skillsDir);
    const mdFiles = files.filter((f) => f.endsWith(".md"));

    if (mdFiles.length === 0) {
        console.log("  ℹ️  /skills directory is empty.");
        return;
    }

    for (const file of mdFiles) {
        try {
            const content = await readFile(join(skillsDir, file), "utf-8");
            const skill = parseSkill(file, content);
            skills.push(skill);
        } catch (err) {
            console.error(`  ⚠️  Failed to load skill "${file}":`, err instanceof Error ? err.message : err);
        }
    }

    const enabled = skills.filter((s) => s.enabled);
    console.log(`  🧩 Loaded ${enabled.length} skill(s): ${enabled.map((s) => s.name).join(", ")}`);
}

/**
 * Get all loaded skills.
 */
export function getSkills(): Skill[] {
    return skills;
}

/**
 * Get skills matching a text query (checks triggers and title).
 */
export function matchSkills(text: string): Skill[] {
    const lower = text.toLowerCase();
    return skills.filter((s) => {
        if (!s.enabled) return false;
        if (s.triggers.some((t) => lower.includes(t.toLowerCase()))) return true;
        if (lower.includes(s.name.toLowerCase())) return true;
        return false;
    });
}

/**
 * Build a system prompt section with all active skills.
 */
export function getSkillsPrompt(): string {
    const active = skills.filter((s) => s.enabled);
    if (active.length === 0) return "";

    const sections = active.map((s) => {
        const header = `### Skill: ${s.title}`;
        const desc = s.description ? `_${s.description}_` : "";
        const triggers = s.triggers.length > 0 ? `_Triggers: ${s.triggers.join(", ")}_` : "";
        return [header, desc, triggers, "", s.content].filter(Boolean).join("\n");
    });

    return `\n\n## Skills\nYou have the following skills — specialized capabilities you can use when relevant:\n\n${sections.join("\n\n---\n\n")}`;
}

// ── Parser ───────────────────────────────────────────

function parseSkill(filename: string, raw: string): Skill {
    const name = basename(filename, ".md");
    let title = name;
    let description = "";
    let triggers: string[] = [];
    let enabled = true;
    let content = raw;

    // Parse frontmatter (between --- markers)
    const fmMatch = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (fmMatch) {
        const frontmatter = fmMatch[1];
        content = fmMatch[2].trim();

        // Parse key: value pairs
        for (const line of frontmatter.split("\n")) {
            const match = line.match(/^(\w+)\s*:\s*(.+)$/);
            if (!match) continue;

            const [, key, value] = match;
            switch (key.toLowerCase()) {
                case "title":
                case "name":
                    title = value.trim();
                    break;
                case "description":
                    description = value.trim();
                    break;
                case "triggers":
                    triggers = value.split(",").map((t) => t.trim()).filter(Boolean);
                    break;
                case "enabled":
                    enabled = value.trim().toLowerCase() !== "false";
                    break;
            }
        }
    } else {
        // Try to extract title from first heading
        const headingMatch = raw.match(/^#\s+(.+)$/m);
        if (headingMatch) {
            title = headingMatch[1].trim();
        }
    }

    return { name, title, description, triggers, content, enabled };
}
