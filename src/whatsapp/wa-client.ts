import makeWASocket, {
    useMultiFileAuthState,
    DisconnectReason,
    fetchLatestBaileysVersion,
    makeCacheableSignalKeyStore,
} from "@whiskeysockets/baileys";
import { Boom } from "@hapi/boom";
import qrcode from "qrcode-terminal";
import pino from "pino";
import { config } from "../config.js";
import { registerWaHandlers } from "./wa-handler.js";

// ── State ────────────────────────────────────────────

let sock: ReturnType<typeof makeWASocket> | null = null;
let isShuttingDown = false;
let reconnectAttempts = 0;
const MAX_RECONNECT_ATTEMPTS = 5;
const RECONNECT_DELAY_MS = 3000; // Wait 3s before reconnecting

const logger = pino({ level: "silent" });

// ── Public API ───────────────────────────────────────

export async function startWhatsApp(): Promise<void> {
    isShuttingDown = false;
    reconnectAttempts = 0;

    await connect();
}

async function connect(): Promise<void> {
    if (isShuttingDown) return;

    const { state, saveCreds } = await useMultiFileAuthState(config.waSessionPath);
    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
        version,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        logger,
        printQRInTerminal: false,
        generateHighQualityLinkPreview: false,
        getMessage: async () => ({ conversation: "" }),
    });

    // ── Connection events ──
    sock.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
            console.log("\n  📱 Scan this QR code with WhatsApp:\n");
            qrcode.generate(qr, { small: true });
            console.log();
        }

        if (connection === "close") {
            const reason = (lastDisconnect?.error as Boom)?.output?.statusCode;

            if (isShuttingDown) return;

            if (reason === DisconnectReason.loggedOut) {
                console.log("  ❌ WhatsApp: logged out. Delete ./wa-session and restart to re-pair.");
                return;
            }

            // 440 = connection replaced by another instance (tsx watch restart) — don't retry
            if (reason === 440) {
                console.log("  ℹ️  WhatsApp: connection replaced by new instance. Standing down.");
                return;
            }

            reconnectAttempts++;

            if (reconnectAttempts > MAX_RECONNECT_ATTEMPTS) {
                console.log(`  ❌ WhatsApp: too many reconnect attempts (${MAX_RECONNECT_ATTEMPTS}). Giving up.`);
                return;
            }

            console.log(`  🔄 WhatsApp: disconnected (reason: ${reason}). Reconnecting in ${RECONNECT_DELAY_MS / 1000}s… (attempt ${reconnectAttempts}/${MAX_RECONNECT_ATTEMPTS})`);

            setTimeout(() => {
                if (!isShuttingDown) {
                    connect();
                }
            }, RECONNECT_DELAY_MS);
        }

        if (connection === "open") {
            reconnectAttempts = 0; // Reset on successful connection
            console.log("  ✅ WhatsApp: connected!");
        }
    });

    sock.ev.on("creds.update", saveCreds);
    registerWaHandlers(sock);
}

export function stopWhatsApp(): void {
    isShuttingDown = true;
    if (sock) {
        sock.end(undefined);
        sock = null;
    }
}

export function getWaSock() {
    return sock;
}
