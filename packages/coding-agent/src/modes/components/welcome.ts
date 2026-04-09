import * as os from "node:os";
import { type Component, padding, truncateToWidth, visibleWidth } from "@oh-my-pi/pi-tui";
import { theme } from "../../modes/theme/theme";

export interface RecentSession {
	name: string;
	timeAgo: string;
}

export interface LspServerInfo {
	name: string;
	status: "ready" | "error" | "connecting";
	fileTypes: string[];
}

interface StorageEntry {
	label: string;
	name: string;
	usedPct: number;
}

interface SystemTelemetry {
	cpuPct: number;
	ramPct: number;
	storage: StorageEntry[];
	localIp: string;
	cwd: string;
	bunVersion: string;
}

/**
 * Mission Control welcome dashboard for OhMyFloyd.
 * Two-column layout: Floyd branding (left) + system telemetry (right).
 */
export class WelcomeComponent implements Component {
	#telemetry: SystemTelemetry | null = null;

	constructor(
		private readonly version: string,
		private modelName: string,
		private providerName: string,
		private recentSessions: RecentSession[] = [],
		private lspServers: LspServerInfo[] = [],
	) {}

	invalidate(): void {
		this.#telemetry = null;
	}

	setModel(modelName: string, providerName: string): void {
		this.modelName = modelName;
		this.providerName = providerName;
	}

	setRecentSessions(sessions: RecentSession[]): void {
		this.recentSessions = sessions;
	}

	setLspServers(servers: LspServerInfo[]): void {
		this.lspServers = servers;
	}

	render(termWidth: number): string[] {
		const telemetry = this.#gatherTelemetry();

		// Box dimensions - responsive with max width for mission control layout
		const maxWidth = 110;
		const boxWidth = Math.min(maxWidth, Math.max(0, termWidth - 2));
		if (boxWidth < 4) return [];

		const dualContentWidth = boxWidth - 3; // 3 = │ + │ + │
		const preferredLeftCol = 30;
		const minLeftCol = 28; // Floyd ASCII art width
		const minRightCol = 30;
		const leftMinContentWidth = Math.max(
			minLeftCol,
			visibleWidth("Legacy AI  &  Floyd's Labs"),
			visibleWidth(this.modelName),
			visibleWidth(this.providerName),
		);
		const desiredLeftCol = Math.min(preferredLeftCol, Math.max(minLeftCol, Math.floor(dualContentWidth * 0.3)));
		const dualLeftCol =
			dualContentWidth >= minRightCol + 1
				? Math.min(desiredLeftCol, dualContentWidth - minRightCol)
				: Math.max(1, dualContentWidth - 1);
		const dualRightCol = Math.max(1, dualContentWidth - dualLeftCol);
		const showRightColumn = dualLeftCol >= leftMinContentWidth && dualRightCol >= minRightCol;
		const leftCol = showRightColumn ? dualLeftCol : boxWidth - 2;
		const rightCol = showRightColumn ? dualRightCol : 0;

		// Floyd ASCII logo (neon blue shadows, hot pink letters, dark purple bg)
		// biome-ignore format: preserve ASCII art layout
		const floydLogo = [
			"░█▀▀░█░░░█▀█░█░█░█▀▄░░░░░░",
			"░█▀▀░█░░░█░█░░█░░█░█░░░░░░",
			"░▀░░░▀▀▀░▀▀▀░░▀░░▀▀░░░░░░░",
			"░█▀▀░█▀█░█▀▄░█▀▀░░░░░░░░░░",
			"░█░░░█░█░█░█░█▀▀░░░░░░░░░░",
			"░▀▀▀░▀▀▀░▀▀░░▀▀▀░░░░░░░░░░",
		];
		const logoColored = floydLogo.map((line, idx) => this.#colorLogoLine(line, idx, floydLogo.length));

		// Left column - branding
		const leftLines = [
			"",
			this.#centerText(theme.bold("Legacy AI  &"), leftCol),
			this.#centerText(theme.bold("Floyd's Labs"), leftCol),
			"",
			...logoColored.map(l => this.#centerText(l, leftCol)),
			"",
			this.#centerText(theme.fg("muted", this.modelName), leftCol),
			this.#centerText(theme.fg("borderMuted", this.providerName), leftCol),
			"",
		];

		// Right column separator
		const separatorWidth = Math.max(0, rightCol - 2);
		const separator = ` ${theme.fg("dim", theme.boxRound.horizontal.repeat(separatorWidth))}`;

		// --- Right column: Mission Control telemetry ---
		const cpuBar = this.#usageBar(telemetry.cpuPct);
		const ramBar = this.#usageBar(telemetry.ramPct);
		const cpuLabel = `CPU ${cpuBar} ${String(telemetry.cpuPct).padStart(3)}%`;
		const ramLabel = `RAM ${ramBar} ${String(telemetry.ramPct).padStart(3)}%`;

		// Storage entries
		const storageLines: string[] = [];
		for (const entry of telemetry.storage.slice(0, 4)) {
			const bar = this.#usageBar(entry.usedPct);
			const pctStr = `${String(entry.usedPct).padStart(3)}%`;
			storageLines.push(
				` ${theme.fg("muted", entry.label)} ${bar} ${theme.fg("dim", pctStr)} ${theme.fg("dim", entry.name)}`,
			);
		}
		if (storageLines.length === 0) {
			storageLines.push(` ${theme.fg("dim", "No drives detected")}`);
		}
		while (storageLines.length < 4) {
			storageLines.push("");
		}

		// Dev telemetry
		const cwdShort = this.#shortenPath(telemetry.cwd, 22);
		const netLabel = telemetry.localIp;

		// LSP summary
		const lspReady = this.lspServers.filter(s => s.status === "ready").length;
		const lspTotal = this.lspServers.length;
		const lspStatus = lspTotal > 0 ? `${lspReady}/${lspTotal} ready` : "None";
		const lspDot =
			lspTotal > 0
				? lspReady === lspTotal
					? "\x1b[38;5;46m\u25CF\x1b[0m"
					: "\x1b[38;5;208m\u25CF\x1b[0m"
				: "\x1b[38;5;240m\u25CF\x1b[0m";

		// Recent sessions
		const sessionLines: string[] = [];
		if (this.recentSessions.length === 0) {
			sessionLines.push(` ${theme.fg("dim", "No recent sessions")}`);
		} else {
			for (const session of this.recentSessions.slice(0, 2)) {
				sessionLines.push(
					` ${theme.fg("dim", "\u2022")} ${theme.fg("muted", session.name)} ${theme.fg("dim", `(${session.timeAgo})`)}`,
				);
			}
		}

		const rightLines = [
			` ${theme.bold(theme.fg("accent", "SYSTEM STATUS"))}`,
			` ${theme.fg("muted", cpuLabel)}  ${theme.fg("dim", "|")}  ${theme.fg("muted", ramLabel)}`,
			separator,
			` ${theme.bold(theme.fg("accent", "STORAGE ARRAY"))}`,
			...storageLines,
			separator,
			` ${theme.fg("dim", "DIR:")} ${theme.fg("muted", cwdShort)}  ${theme.fg("dim", "|")}  ${theme.fg("dim", "NET:")} ${theme.fg("muted", netLabel)}`,
			` ${theme.fg("dim", "LSP:")} ${lspDot} ${theme.fg("muted", lspStatus)}  ${theme.fg("dim", "|")}  ${theme.fg("dim", "BUN:")} ${theme.fg("muted", telemetry.bunVersion)}`,
			separator,
			` ${theme.bold(theme.fg("accent", "Recent Sessions"))}`,
			...sessionLines,
		];

		// Border characters
		const hChar = theme.boxRound.horizontal;
		const h = theme.fg("dim", hChar);
		const v = theme.fg("dim", theme.boxRound.vertical);
		const tl = theme.fg("dim", theme.boxRound.topLeft);
		const tr = theme.fg("dim", theme.boxRound.topRight);
		const bl = theme.fg("dim", theme.boxRound.bottomLeft);
		const br = theme.fg("dim", theme.boxRound.bottomRight);

		const lines: string[] = [];

		// Top border with OMF branding
		const title = ` omf v${this.version} \u2500 LegacyAI.space / FloydsLabs.com \u2500 \u00A92026 `;
		const titlePrefixRaw = hChar.repeat(3);
		const titleStyled = theme.fg("dim", titlePrefixRaw) + theme.fg("muted", title);
		const titleVisLen = visibleWidth(titlePrefixRaw) + visibleWidth(title);
		const titleSpace = boxWidth - 2;
		if (titleVisLen >= titleSpace) {
			lines.push(tl + truncateToWidth(titleStyled, titleSpace) + tr);
		} else {
			const afterTitle = titleSpace - titleVisLen;
			lines.push(tl + titleStyled + theme.fg("dim", hChar.repeat(afterTitle)) + tr);
		}

		// Content rows
		const maxRows = showRightColumn ? Math.max(leftLines.length, rightLines.length) : leftLines.length;
		for (let i = 0; i < maxRows; i++) {
			const left = this.#fitToWidth(leftLines[i] ?? "", leftCol);
			if (showRightColumn) {
				const right = this.#fitToWidth(rightLines[i] ?? "", rightCol);
				lines.push(v + left + v + right + v);
			} else {
				lines.push(v + left + v);
			}
		}

		// Bottom border
		if (showRightColumn) {
			lines.push(bl + h.repeat(leftCol) + theme.fg("dim", theme.boxSharp.teeUp) + h.repeat(rightCol) + br);
		} else {
			lines.push(bl + h.repeat(leftCol) + br);
		}

		return lines;
	}

	// ── Telemetry gathering ─────────────────────────────────────────

	#gatherTelemetry(): SystemTelemetry {
		if (this.#telemetry) return this.#telemetry;

		const loadAvg = os.loadavg()[0] ?? 0;
		const cpuCount = os.cpus().length || 1;
		const cpuPct = Math.min(100, Math.round((loadAvg / cpuCount) * 100));

		const totalMem = os.totalmem();
		const freeMem = os.freemem();
		const ramPct = Math.round(((totalMem - freeMem) / totalMem) * 100);

		const storage = this.#detectStorage();
		const localIp = this.#getLocalIp();
		const cwd = process.cwd();
		const bunVersion = typeof Bun !== "undefined" ? Bun.version : process.version;

		this.#telemetry = { cpuPct, ramPct, storage, localIp, cwd, bunVersion };
		return this.#telemetry;
	}

	#detectStorage(): StorageEntry[] {
		try {
			const result = Bun.spawnSync(["df", "-h"], { stdout: "pipe", stderr: "pipe" });
			const output = result.stdout.toString();
			const dfLines = output.split("\n").slice(1);
			const entries: StorageEntry[] = [];

			for (const line of dfLines) {
				if (!line.trim()) continue;
				// macOS df -h: Filesystem Size Used Avail Capacity iused ifree %iused Mounted_on
				const parts = line.trim().split(/\s+/);
				if (parts.length < 9) continue;

				const sizeStr = parts[1] ?? "";
				const capStr = parts[4] ?? "";
				const mountPoint = parts.slice(8).join(" ");

				const capacity = parseInt(capStr, 10);
				if (Number.isNaN(capacity)) continue;
				const sizeGb = this.#parseSizeGb(sizeStr);

				if (mountPoint === "/") {
					const label = sizeGb >= 900 ? "INT 1TB " : sizeGb >= 400 ? "INT 500G" : `INT ${Math.round(sizeGb)}G `;
					entries.push({ label, name: "System", usedPct: capacity });
				} else if (
					mountPoint.startsWith("/Volumes/") &&
					!mountPoint.includes("com.apple") &&
					!mountPoint.includes("CoreSimulator") &&
					!mountPoint.includes("/Volumes/Update") &&
					sizeGb >= 100
				) {
					const volName = mountPoint.replace("/Volumes/", "");
					const sizeLabel =
						sizeGb >= 900 ? "EXT 1TB " : sizeGb >= 400 ? "EXT 500G" : `EXT ${Math.round(sizeGb)}G `;
					entries.push({ label: sizeLabel, name: volName, usedPct: capacity });
				}
			}

			return entries;
		} catch {
			return [];
		}
	}

	#parseSizeGb(s: string): number {
		const m = s.match(/^([\d.]+)([KMGTP])i?$/i);
		if (!m) return 0;
		const v = parseFloat(m[1] ?? "0");
		switch ((m[2] ?? "").toUpperCase()) {
			case "T":
				return v * 1024;
			case "G":
				return v;
			case "M":
				return v / 1024;
			case "K":
				return v / (1024 * 1024);
			default:
				return 0;
		}
	}

	#getLocalIp(): string {
		const interfaces = os.networkInterfaces();
		for (const addrs of Object.values(interfaces)) {
			for (const addr of addrs ?? []) {
				if (addr.family === "IPv4" && !addr.internal) {
					return addr.address;
				}
			}
		}
		return "127.0.0.1";
	}

	// ── Rendering helpers ───────────────────────────────────────────

	#usageBar(pct: number, ticks = 10): string {
		const filled = Math.round((pct / 100) * ticks);
		const empty = ticks - filled;
		const color = pct >= 90 ? "\x1b[38;5;196m" : pct >= 70 ? "\x1b[38;5;208m" : "\x1b[38;5;46m";
		const dim = "\x1b[38;5;240m";
		const reset = "\x1b[0m";
		return `${dim}[${reset}${color}${"|".repeat(filled)}${reset}${dim}${".".repeat(empty)}]${reset}`;
	}

	#shortenPath(fullPath: string, maxLen: number): string {
		if (fullPath.length <= maxLen) return fullPath;
		const parts = fullPath.split("/").filter(Boolean);
		if (parts.length <= 2) return fullPath;
		return `.../${parts.slice(-2).join("/")}`;
	}

	/** Center text within a given width */
	#centerText(text: string, width: number): string {
		const visLen = visibleWidth(text);
		if (visLen >= width) return truncateToWidth(text, width);
		const leftPad = Math.floor((width - visLen) / 2);
		const rightPad = width - visLen - leftPad;
		return padding(leftPad) + text + padding(rightPad);
	}

	/** Apply neon styling to Floyd logo line */
	#colorLogoLine(line: string, lineIndex: number, totalLines: number): string {
		const neonBlue = "\x1b[38;5;45m";
		const hotPink = "\x1b[38;5;199m";
		const bgColors = [
			"\x1b[48;5;54m", // dark purple (top)
			"\x1b[48;5;53m",
			"\x1b[48;5;55m",
			"\x1b[48;5;234m", // very dark purple-gray
			"\x1b[48;5;235m",
			"\x1b[48;5;233m", // almost black (bottom)
		];
		const reset = "\x1b[0m";

		const bgIdx = Math.min(Math.floor((lineIndex / totalLines) * bgColors.length), bgColors.length - 1);
		const bg = bgColors[bgIdx] ?? "";

		let result = bg;
		for (const char of line) {
			if (char === "\u2591") {
				result += neonBlue + char + reset + bg;
			} else if (char === "\u2588" || char === "\u2580" || char === "\u2584") {
				result += hotPink + char + reset + bg;
			} else if (char === " ") {
				result += char;
			} else {
				result += char;
			}
		}
		result += reset;
		return result;
	}

	/** Fit string to exact width with ANSI-aware truncation/padding */
	#fitToWidth(str: string, width: number): string {
		const visLen = visibleWidth(str);
		if (visLen > width) {
			const ellipsis = "\u2026";
			const ellipsisWidth = visibleWidth(ellipsis);
			const maxWidth = Math.max(0, width - ellipsisWidth);
			let truncated = "";
			let currentWidth = 0;
			let inEscape = false;
			for (const char of str) {
				if (char === "\x1b") inEscape = true;
				if (inEscape) {
					truncated += char;
					if (char === "m") inEscape = false;
				} else if (currentWidth < maxWidth) {
					truncated += char;
					currentWidth++;
				}
			}
			return `${truncated}${ellipsis}`;
		}
		return str + padding(width - visLen);
	}
}
