#!/usr/bin/env node
/**
 * Vault CLI — manage encrypted secrets.
 *
 * Usage:
 *   npx tsx src/security/vault-cli.ts generate-key
 *   npx tsx src/security/vault-cli.ts set SECRET_NAME secret_value
 *   npx tsx src/security/vault-cli.ts get SECRET_NAME
 *   npx tsx src/security/vault-cli.ts remove SECRET_NAME
 *   npx tsx src/security/vault-cli.ts list
 *   npx tsx src/security/vault-cli.ts migrate
 *
 * Requires VAULT_MASTER_KEY env var for all operations except generate-key.
 */

import "dotenv/config";
import {
    generateMasterKey,
    initVault,
    setSecret,
    getSecret,
    removeSecret,
    listSecrets,
    migrateFromEnv,
} from "./vault.js";

const [, , command, ...args] = process.argv;

// Secrets that can be migrated from .env
const MIGRATABLE_SECRETS = [
    "OPENROUTER_API_KEY",
    "ANTHROPIC_API_KEY",
    "OPENAI_API_KEY",
    "GROQ_API_KEY",
    "TELEGRAM_BOT_TOKEN",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_KEY",
    "ELEVENLABS_API_KEY",
    "BRAVE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_API_KEY",
    "GOOGLE_SEARCH_CX",
    "WEBHOOK_SECRET",
];

async function main(): Promise<void> {
    switch (command) {
        case "generate-key": {
            const key = generateMasterKey();
            console.log("\n🔑 Generated master key:\n");
            console.log(`   ${key}`);
            console.log("\n📋 Add to your .env:\n");
            console.log(`   VAULT_MASTER_KEY=${key}\n`);
            console.log("⚠️  Keep this key safe — losing it means losing access to all encrypted secrets.");
            break;
        }

        case "set": {
            if (args.length < 2) {
                console.error("Usage: vault-cli set SECRET_NAME secret_value");
                process.exit(1);
            }
            await initVault();
            const [name, ...valueParts] = args;
            const value = valueParts.join(" ");
            await setSecret(name, value);
            console.log(`✅ Secret "${name}" stored in vault.`);
            break;
        }

        case "get": {
            if (args.length < 1) {
                console.error("Usage: vault-cli get SECRET_NAME");
                process.exit(1);
            }
            await initVault();
            const val = getSecret(args[0]);
            if (val) {
                console.log(`${args[0]}=${val}`);
            } else {
                console.log(`❌ Secret "${args[0]}" not found.`);
            }
            break;
        }

        case "remove": {
            if (args.length < 1) {
                console.error("Usage: vault-cli remove SECRET_NAME");
                process.exit(1);
            }
            await initVault();
            const removed = await removeSecret(args[0]);
            if (removed) {
                console.log(`✅ Secret "${args[0]}" removed from vault.`);
            } else {
                console.log(`❌ Secret "${args[0]}" not found in vault.`);
            }
            break;
        }

        case "list": {
            await initVault();
            const names = await listSecrets();
            if (names.length === 0) {
                console.log("🔐 Vault is empty.");
            } else {
                console.log(`🔐 Vault contains ${names.length} secret(s):\n`);
                for (const n of names) {
                    console.log(`   • ${n}`);
                }
            }
            break;
        }

        case "migrate": {
            await initVault();
            console.log("📦 Migrating secrets from .env to vault...\n");
            const { migrated, skipped } = await migrateFromEnv(MIGRATABLE_SECRETS);
            if (migrated.length > 0) {
                console.log(`✅ Migrated ${migrated.length} secret(s):`);
                for (const m of migrated) console.log(`   • ${m}`);
            }
            if (skipped.length > 0) {
                console.log(`\n⏭️  Skipped ${skipped.length} (not set in env):`);
                for (const s of skipped) console.log(`   • ${s}`);
            }
            console.log("\n💡 You can now remove the migrated values from .env.");
            break;
        }

        default:
            console.log(`
🔐 Vault CLI — Encrypted Secret Storage

Commands:
  generate-key          Generate a new master key
  set NAME VALUE        Store a secret
  get NAME              Retrieve a secret
  remove NAME           Remove a secret
  list                  List all secret names
  migrate               Migrate API keys from .env to vault

Requires: VAULT_MASTER_KEY in .env
`);
            break;
    }
}

main().catch((err) => {
    console.error("❌", err.message);
    process.exit(1);
});
