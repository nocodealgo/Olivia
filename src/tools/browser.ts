import type Anthropic from "@anthropic-ai/sdk";
import { chromium, type Browser, type Page } from "playwright";
import { writeFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { checkEndpoint } from "../security/policy.js";

// ── Persistent browser session ───────────────────────

let browser: Browser | null = null;
let page: Page | null = null;

async function getPage(): Promise<Page> {
    if (!browser || !browser.isConnected()) {
        browser = await chromium.launch({ headless: true });
    }
    if (!page || page.isClosed()) {
        const context = await browser.newContext({
            viewport: { width: 1280, height: 800 },
            userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        });
        page = await context.newPage();
    }
    return page;
}

// Screenshots directory
const SCREENSHOTS_DIR = join(homedir(), "Giorgio", "screenshots");

export const browserTool = {
    definition: {
        name: "browser",
        description: `Browser automation tool. Perform web actions like navigating to URLs, clicking elements, typing text, taking screenshots, and extracting page content. Actions: navigate, click, type, screenshot, extract, scroll, evaluate.`,
        input_schema: {
            type: "object" as const,
            properties: {
                action: {
                    type: "string",
                    enum: ["navigate", "click", "type", "screenshot", "extract", "scroll", "evaluate"],
                    description: "The browser action to perform.",
                },
                url: {
                    type: "string",
                    description: "URL to navigate to (for 'navigate' action).",
                },
                selector: {
                    type: "string",
                    description: "CSS selector for the target element (for 'click', 'type' actions).",
                },
                text: {
                    type: "string",
                    description: "Text to type (for 'type' action).",
                },
                script: {
                    type: "string",
                    description: "JavaScript code to evaluate in the page (for 'evaluate' action).",
                },
                direction: {
                    type: "string",
                    enum: ["up", "down"],
                    description: "Scroll direction (for 'scroll' action). Default: down.",
                },
                wait_ms: {
                    type: "number",
                    description: "Time to wait after action in ms (default: 1000).",
                },
            },
            required: ["action"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const action = input.action as string;
        const waitMs = (input.wait_ms as number) || 1000;

        try {
            switch (action) {
                case "navigate":
                    return await doNavigate(input.url as string, waitMs);
                case "click":
                    return await doClick(input.selector as string, waitMs);
                case "type":
                    return await doType(input.selector as string, input.text as string, waitMs);
                case "screenshot":
                    return await doScreenshot();
                case "extract":
                    return await doExtract();
                case "scroll":
                    return await doScroll((input.direction as string) || "down", waitMs);
                case "evaluate":
                    return await doEvaluate(input.script as string);
                default:
                    return JSON.stringify({ error: "UNKNOWN_ACTION", message: `Unknown action: ${action}` });
            }
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return JSON.stringify({ error: "BROWSER_ERROR", message });
        }
    },
};

// ── Actions ──────────────────────────────────────────

async function doNavigate(url: string, waitMs: number): Promise<string> {
    if (!url) return JSON.stringify({ error: "MISSING_URL", message: "URL is required for navigate action." });

    // Block file:// URLs and internal network access
    if (url.startsWith("file://")) {
        return JSON.stringify({ error: "BLOCKED", message: "file:// URLs are not allowed." });
    }

    const endpointCheck = checkEndpoint(url);
    if (!endpointCheck.allowed) {
        return JSON.stringify({ error: "BLOCKED", message: endpointCheck.reason });
    }

    const p = await getPage();
    const response = await p.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    await p.waitForTimeout(waitMs);

    return JSON.stringify({
        action: "navigate",
        url: p.url(),
        title: await p.title(),
        status: response?.status(),
    });
}

async function doClick(selector: string, waitMs: number): Promise<string> {
    if (!selector) return JSON.stringify({ error: "MISSING_SELECTOR", message: "Selector is required for click action." });

    const p = await getPage();
    await p.click(selector, { timeout: 5000 });
    await p.waitForTimeout(waitMs);

    return JSON.stringify({
        action: "click",
        selector,
        url: p.url(),
        title: await p.title(),
    });
}

async function doType(selector: string, text: string, waitMs: number): Promise<string> {
    if (!selector || !text) return JSON.stringify({ error: "MISSING_PARAMS", message: "Selector and text are required." });

    const p = await getPage();
    await p.fill(selector, text, { timeout: 5000 });
    await p.waitForTimeout(waitMs);

    return JSON.stringify({
        action: "type",
        selector,
        typed: text.length + " chars",
    });
}

async function doScreenshot(): Promise<string> {
    const p = await getPage();
    await mkdir(SCREENSHOTS_DIR, { recursive: true });

    const filename = `screenshot_${Date.now()}.png`;
    const filepath = join(SCREENSHOTS_DIR, filename);

    await p.screenshot({ path: filepath, fullPage: false });

    return JSON.stringify({
        action: "screenshot",
        path: filepath,
        url: p.url(),
        title: await p.title(),
    });
}

async function doExtract(): Promise<string> {
    const p = await getPage();

    // Extract structured content
    const data = await p.evaluate(() => {
        const title = document.title;
        const url = location.href;

        // Get main text content, cleaned up
        const body = document.body;
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT, null);
        const texts: string[] = [];
        let node: Node | null;
        while ((node = walker.nextNode())) {
            const text = node.textContent?.trim();
            if (text && text.length > 2) {
                const parent = node.parentElement;
                if (parent && !["SCRIPT", "STYLE", "NOSCRIPT"].includes(parent.tagName)) {
                    texts.push(text);
                }
            }
        }

        // Get all links
        const links = Array.from(document.querySelectorAll("a[href]"))
            .slice(0, 20)
            .map((a) => ({
                text: (a as HTMLAnchorElement).innerText.trim().slice(0, 80),
                href: (a as HTMLAnchorElement).href,
            }))
            .filter((l) => l.text);

        // Get all form inputs
        const inputs = Array.from(document.querySelectorAll("input, textarea, select"))
            .slice(0, 15)
            .map((el) => ({
                type: (el as HTMLInputElement).type || el.tagName.toLowerCase(),
                name: (el as HTMLInputElement).name,
                id: el.id,
                placeholder: (el as HTMLInputElement).placeholder,
            }));

        return {
            title,
            url,
            text: texts.join("\n").slice(0, 6000),
            links,
            inputs,
        };
    });

    return JSON.stringify(data);
}

async function doScroll(direction: string, waitMs: number): Promise<string> {
    const p = await getPage();
    const amount = direction === "up" ? -500 : 500;
    await p.evaluate((scrollAmount) => window.scrollBy(0, scrollAmount), amount);
    await p.waitForTimeout(waitMs);

    return JSON.stringify({
        action: "scroll",
        direction,
        url: p.url(),
    });
}

async function doEvaluate(script: string): Promise<string> {
    if (!script) return JSON.stringify({ error: "MISSING_SCRIPT", message: "Script is required for evaluate action." });

    // Audit log for evaluate calls
    console.log(`  🔒 Browser evaluate: ${script.slice(0, 100)}${script.length > 100 ? "…" : ""}`);

    const p = await getPage();
    const result = await p.evaluate(script);

    return JSON.stringify({
        action: "evaluate",
        result: typeof result === "string" ? result.slice(0, 4000) : JSON.stringify(result)?.slice(0, 4000),
    });
}

// ── Cleanup ──────────────────────────────────────────

export async function closeBrowser(): Promise<void> {
    if (page && !page.isClosed()) await page.close().catch(() => { });
    if (browser) await browser.close().catch(() => { });
    page = null;
    browser = null;
}
