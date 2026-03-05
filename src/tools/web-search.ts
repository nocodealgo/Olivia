import type Anthropic from "@anthropic-ai/sdk";
import { airGapCheck } from "../security/airgap.js";

// ── Web Search Tool ──────────────────────────────────
// Primary: Brave Search API (when API key configured)
// Fallback: DuckDuckGo HTML search (no API key required)

const BRAVE_API_KEY = process.env.BRAVE_SEARCH_API_KEY || "";
const BRAVE_ENABLED = !!BRAVE_API_KEY;

const GOOGLE_API_KEY = process.env.GOOGLE_SEARCH_API_KEY || "";
const GOOGLE_CX = process.env.GOOGLE_SEARCH_CX || "";
const GOOGLE_ENABLED = !!(GOOGLE_API_KEY && GOOGLE_CX);

const SEARCH_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
};

interface SearchResult {
    title: string;
    url: string;
    snippet: string;
}

export const webSearch = {
    definition: {
        name: "web_search",
        description:
            "Search the web for current information. Uses Brave Search when configured, DuckDuckGo as fallback. Returns top results with titles, URLs, and text snippets.",
        input_schema: {
            type: "object" as const,
            properties: {
                query: {
                    type: "string",
                    description: "The search query (e.g. 'weather in Mexico City', 'Node.js 22 features').",
                },
                max_results: {
                    type: "number",
                    description: "Max results to return (default: 5, max: 10).",
                },
            },
            required: ["query"],
        },
    } satisfies Anthropic.Tool,

    async execute(input: Record<string, unknown>): Promise<string> {
        const query = input.query as string;
        const maxResults = Math.min((input.max_results as number) || 5, 10);

        if (!query?.trim()) {
            return JSON.stringify({ error: "MISSING_QUERY", message: "Search query is required." });
        }

        const blocked = airGapCheck("web search");
        if (blocked) return JSON.stringify({ error: "AIRGAP", message: blocked });

        try {
            // Try Brave Search first if configured
            if (BRAVE_ENABLED) {
                const results = await searchBrave(query, maxResults);
                if (results.length > 0) {
                    return JSON.stringify({ query, results, source: "brave" });
                }
            }

            // Fallback: Google Custom Search
            if (GOOGLE_ENABLED) {
                const gResults = await searchGoogle(query, maxResults);
                if (gResults.length > 0) {
                    return JSON.stringify({ query, results: gResults, source: "google" });
                }
            }

            // Fallback: DuckDuckGo HTML search
            const results = await searchDuckDuckGo(query, maxResults);
            if (results.length > 0) {
                return JSON.stringify({ query, results, source: "duckduckgo" });
            }

            // Last resort: DuckDuckGo Instant Answer API
            const instant = await instantAnswer(query);
            if (instant) {
                return JSON.stringify({ query, instant_answer: instant, source: "duckduckgo_instant" });
            }

            return JSON.stringify({ query, results: [], message: "No results found." });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            return JSON.stringify({ error: "SEARCH_ERROR", message });
        }
    },
};

// ── Brave Search API ─────────────────────────────────

async function searchBrave(query: string, maxResults: number): Promise<SearchResult[]> {
    const url = `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${maxResults}`;

    const response = await fetch(url, {
        headers: {
            "Accept": "application/json",
            "Accept-Encoding": "gzip",
            "X-Subscription-Token": BRAVE_API_KEY,
        },
        signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
        console.log(`  ⚠️  Brave Search API error: ${response.status}. Falling back to DuckDuckGo.`);
        return [];
    }

    const data = (await response.json()) as {
        web?: { results?: Array<{ title: string; url: string; description: string }> };
    };

    if (!data.web?.results) return [];

    return data.web.results.map((item) => ({
        title: item.title,
        url: item.url,
        snippet: item.description || "",
    }));
}

// ── Google Custom Search ─────────────────────────────

async function searchGoogle(query: string, maxResults: number): Promise<SearchResult[]> {
    const url = `https://www.googleapis.com/customsearch/v1?key=${GOOGLE_API_KEY}&cx=${GOOGLE_CX}&q=${encodeURIComponent(query)}&num=${maxResults}`;

    const response = await fetch(url, { signal: AbortSignal.timeout(10000) });

    if (!response.ok) {
        console.log(`  ⚠️  Google Search API error: ${response.status}. Trying next provider.`);
        return [];
    }

    const data = (await response.json()) as {
        items?: Array<{ title: string; link: string; snippet: string }>;
    };

    if (!data.items) return [];

    return data.items.map((item) => ({
        title: item.title,
        url: item.link,
        snippet: item.snippet || "",
    }));
}

// ── DuckDuckGo HTML search ───────────────────────────

async function searchDuckDuckGo(query: string, maxResults: number): Promise<SearchResult[]> {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await fetch(url, {
        headers: SEARCH_HEADERS,
        signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) return [];

    const html = await response.text();
    return parseResults(html, maxResults);
}

function parseResults(html: string, maxResults: number): SearchResult[] {
    const results: SearchResult[] = [];

    // Match result blocks: <a class="result__a" href="...">title</a> and snippet
    const resultBlocks = html.split(/class="result\s/);

    for (let i = 1; i < resultBlocks.length && results.length < maxResults; i++) {
        const block = resultBlocks[i];

        // Extract URL
        const urlMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/);
        if (!urlMatch) continue;

        let url = urlMatch[1];
        // DuckDuckGo wraps URLs in redirect — extract the real URL
        const realUrlMatch = url.match(/uddg=([^&]+)/);
        if (realUrlMatch) {
            url = decodeURIComponent(realUrlMatch[1]);
        }

        // Extract title
        const titleMatch = block.match(/class="result__a"[^>]*>([^<]+)</);
        const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : "";

        // Extract snippet
        const snippetMatch = block.match(/class="result__snippet"[^>]*>(.+?)<\/a>/s);
        const snippet = snippetMatch
            ? decodeEntities(snippetMatch[1].replace(/<[^>]+>/g, "").trim())
            : "";

        if (title && url && !url.includes("duckduckgo.com")) {
            results.push({ title, url, snippet });
        }
    }

    return results;
}

// ── DuckDuckGo Instant Answer API ────────────────────

async function instantAnswer(query: string): Promise<string | null> {
    const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(query)}&format=json&no_html=1&skip_disambig=1`;

    const response = await fetch(url, {
        headers: SEARCH_HEADERS,
        signal: AbortSignal.timeout(5000),
    });

    if (!response.ok) return null;

    const data = (await response.json()) as {
        Abstract?: string;
        AbstractText?: string;
        AbstractURL?: string;
        Answer?: string;
    };

    if (data.AbstractText) {
        return `${data.AbstractText}\n\nSource: ${data.AbstractURL || "DuckDuckGo"}`;
    }

    if (data.Answer) {
        return data.Answer;
    }

    return null;
}

// ── Helpers ──────────────────────────────────────────

function decodeEntities(text: string): string {
    return text
        .replace(/&amp;/g, "&")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&nbsp;/g, " ");
}
