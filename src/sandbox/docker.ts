import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { homedir } from "node:os";

const execFileAsync = promisify(execFile);

// ── Config ───────────────────────────────────────────

/** Enable Docker sandboxing (default: false — set SANDBOX_ENABLED=true to enable) */
const SANDBOX_ENABLED = process.env.SANDBOX_ENABLED === "true";

/** Docker image to use for sandboxed commands */
const SANDBOX_IMAGE = process.env.SANDBOX_IMAGE || "ubuntu:22.04";

/** Directories allowed to mount (read-only by default) */
const ALLOWED_MOUNTS = (process.env.SANDBOX_MOUNTS || "").split(",").filter(Boolean);

/** Directories with read-write access */
const RW_MOUNTS = (process.env.SANDBOX_RW_MOUNTS || "").split(",").filter(Boolean);

/** Default mount: ~/Giorgio as read-write workspace */
const DEFAULT_WORKSPACE = process.env.SANDBOX_WORKSPACE || `${homedir()}/Giorgio`;

// ── Public API ───────────────────────────────────────

export function isSandboxEnabled(): boolean {
    return SANDBOX_ENABLED;
}

/**
 * Check if Docker is available on the system.
 */
export async function checkDockerAvailable(): Promise<boolean> {
    try {
        await execFileAsync("docker", ["info"], { timeout: 5000 });
        return true;
    } catch {
        return false;
    }
}

/**
 * Execute a command inside a sandboxed Docker container.
 * - Uses --rm (auto-cleanup)
 * - Uses --network=none (no network access) unless explicitly allowed
 * - Mounts only allowed directories
 * - Memory limited to 256MB, CPU limited to 1 core
 * - PID limit to prevent fork bombs
 */
export async function runSandboxed(
    command: string,
    opts: {
        timeoutMs?: number;
        allowNetwork?: boolean;
        extraMounts?: Array<{ host: string; container: string; readOnly?: boolean }>;
    } = {}
): Promise<{ stdout: string; stderr: string }> {
    const timeoutMs = opts.timeoutMs || 30000;

    const dockerArgs = [
        "run",
        "--rm",                          // Auto-cleanup container
        "--memory=256m",                 // Memory limit
        "--memory-swap=256m",            // No swap
        "--cpus=1",                      // 1 CPU core
        "--pids-limit=100",              // Prevent fork bombs
        "--read-only",                   // Read-only root filesystem
        "--tmpfs", "/tmp:rw,noexec,nosuid,size=64m",  // Writable /tmp
    ];

    // Network isolation (default: no network)
    if (!opts.allowNetwork) {
        dockerArgs.push("--network=none");
    }

    // Mount the default workspace as read-write
    dockerArgs.push("-v", `${DEFAULT_WORKSPACE}:/workspace:rw`);
    dockerArgs.push("-w", "/workspace");

    // Mount allowed read-only directories
    for (const mount of ALLOWED_MOUNTS) {
        const trimmed = mount.trim();
        if (trimmed) {
            dockerArgs.push("-v", `${trimmed}:${trimmed}:ro`);
        }
    }

    // Mount read-write directories
    for (const mount of RW_MOUNTS) {
        const trimmed = mount.trim();
        if (trimmed) {
            dockerArgs.push("-v", `${trimmed}:${trimmed}:rw`);
        }
    }

    // Extra mounts from caller
    if (opts.extraMounts) {
        for (const m of opts.extraMounts) {
            dockerArgs.push("-v", `${m.host}:${m.container}:${m.readOnly ? "ro" : "rw"}`);
        }
    }

    // Image and command
    dockerArgs.push(SANDBOX_IMAGE, "/bin/sh", "-c", command);

    const { stdout, stderr } = await execFileAsync("docker", dockerArgs, {
        timeout: timeoutMs + 5000, // Extra buffer for container startup
        maxBuffer: 1024 * 1024,
    });

    return { stdout, stderr };
}
