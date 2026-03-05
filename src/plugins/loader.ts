/**
 * Plugin Loader — discovers and loads plugins from the plugins/ directory.
 *
 * Plugins are TypeScript/JavaScript modules that export a PluginMetadata object
 * as their default export or as a named `plugin` export.
 *
 * Directory structure:
 *   plugins/
 *     my-plugin/
 *       index.ts       <- exports plugin metadata
 *     another-plugin.ts
 */

import { readdir, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { pathToFileURL } from "node:url";
import { registerPlugin } from "./registry.js";
import type { PluginMetadata } from "./traits.js";

const PLUGINS_DIR = process.env.PLUGINS_DIR || resolve("plugins");

/**
 * Scan the plugins directory and load all discovered plugins.
 */
export async function loadPlugins(): Promise<number> {
    let count = 0;

    try {
        await stat(PLUGINS_DIR);
    } catch {
        // plugins/ directory doesn't exist — nothing to load
        return 0;
    }

    const entries = await readdir(PLUGINS_DIR, { withFileTypes: true });

    for (const entry of entries) {
        try {
            let modulePath: string;

            if (entry.isDirectory()) {
                // Look for index.ts or index.js inside the directory
                const dirPath = join(PLUGINS_DIR, entry.name);
                const indexTs = join(dirPath, "index.ts");
                const indexJs = join(dirPath, "index.js");

                try {
                    await stat(indexTs);
                    modulePath = indexTs;
                } catch {
                    try {
                        await stat(indexJs);
                        modulePath = indexJs;
                    } catch {
                        continue; // No index file found
                    }
                }
            } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".js")) {
                modulePath = join(PLUGINS_DIR, entry.name);
            } else {
                continue; // Skip non-TS/JS files
            }

            // Dynamic import
            const moduleUrl = pathToFileURL(modulePath).href;
            const mod = await import(moduleUrl);

            const meta: PluginMetadata | undefined = mod.default || mod.plugin;

            if (meta && meta.name && meta.provides) {
                registerPlugin(meta);
                count++;
            } else {
                console.warn(`  ⚠️  Plugin "${entry.name}": no valid PluginMetadata export found.`);
            }
        } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            console.error(`  ❌ Plugin "${entry.name}" failed to load: ${msg}`);
        }
    }

    if (count > 0) {
        console.log(`  📦 Loaded ${count} plugin(s) from ${PLUGINS_DIR}`);
    }

    return count;
}
