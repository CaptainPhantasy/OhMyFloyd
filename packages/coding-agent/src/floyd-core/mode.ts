import * as path from "node:path";
import type { FloydClient, FloydProject, FloydStreamEvent } from "@floyd/sdk";
import { Box, Input, ProcessTerminal, replaceTabs, Spacer, Text, TUI, truncateToWidth } from "@oh-my-pi/pi-tui";
import chalk from "chalk";

const ACTOR = "ohmyfloyd";
const MAX_EVENT_WIDTH = 240;
const MAX_TRANSCRIPT_ITEMS = 80;
const MAX_ASSISTANT_CHARS = 64 * 1024;

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function textValue(value: unknown, fallback = ""): string {
	return typeof value === "string" ? value : fallback;
}

function displayError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function sanitizeTerminalText(text: string): string {
	return replaceTabs(
		text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, ""),
	);
}

function safeDisplay(text: string): string {
	return truncateToWidth(sanitizeTerminalText(text), MAX_EVENT_WIDTH);
}

export interface FloydCoreModeOptions {
	client: FloydClient;
	cwd: string;
	projectId?: string;
}

/**
 * Presentation-only coding partner. Provider SDKs, credentials, tool
 * execution, durable sessions, and review decisions remain behind Floyd Core.
 */
export class FloydCoreMode {
	readonly #client: FloydClient;
	readonly #cwd: string;
	readonly #requestedProjectId?: string;
	readonly #ui = new TUI(new ProcessTerminal());
	readonly #transcript = new Box(0, 0);
	readonly #input = new Input();
	readonly #done: Promise<void>;
	#resolveDone: () => void;
	#projectId?: string;
	#runId?: string;
	#sessionId?: string;
	#streamAbort?: AbortController;
	#streamTask?: Promise<void>;
	#assistantText?: Text;
	#inputChain = Promise.resolve();
	#closed = false;

	constructor(options: FloydCoreModeOptions) {
		this.#client = options.client;
		this.#cwd = path.resolve(options.cwd);
		this.#requestedProjectId = options.projectId;
		const deferred = Promise.withResolvers<void>();
		this.#done = deferred.promise;
		this.#resolveDone = deferred.resolve;
	}

	async run(initialMessage?: string): Promise<void> {
		await this.resolveProject();
		const health = await this.#client.health();
		const frame = new Box(1, 1, line => chalk.bgHex("#11131a")(line));
		frame.addChild(
			new Text(
				`${chalk.bold(chalk.hex("#8be9fd")("FLOYD CURSE'M"))}  ${chalk.hex("#bd93f9")("natural-language coding partner")}\n` +
					`Core ${health.ok ? "online" : "offline"}  OpenCode ${health.engine.ok ? "online" : "offline"}  Project ${this.#projectId}  ${this.#cwd}`,
				1,
				0,
			),
		);
		frame.addChild(new Spacer(1));
		frame.addChild(this.#transcript);
		frame.addChild(new Spacer(1));
		frame.addChild(new Text(chalk.dim("Describe a change or type /help. Escape or Ctrl+C exits."), 1, 0));
		frame.addChild(this.#input);
		this.#ui.addChild(frame);
		this.#input.onSubmit = value => {
			this.#input.setValue("");
			this.#enqueueInput(value.trim());
		};
		this.#input.onEscape = () => this.stop();
		this.#ui.addInputListener(data => {
			if (data === "\x03") {
				this.stop();
				return { consume: true };
			}
			return undefined;
		});
		this.#ui.setFocus(this.#input);
		this.#ui.start();
		this.#addSystem("Floyd Core owns this session. Type a coding goal to begin.");
		if (initialMessage) await this.#handleInput(initialMessage);
		await this.#done;
	}

	stop(): void {
		if (this.#closed) return;
		this.#closed = true;
		// Abort the fetch body immediately, then wait for FloydClient.stream's
		// reader cancellation before restoring the terminal and resolving run().
		this.#streamAbort?.abort();
		const streamTask = this.#streamTask;
		void (async () => {
			await streamTask;
			this.#streamAbort = undefined;
			this.#streamTask = undefined;
			this.#ui.stop();
			this.#resolveDone();
		})();
	}

	async resolveProject(): Promise<string> {
		const state = await this.#client.state();
		let project: FloydProject | undefined;
		if (this.#requestedProjectId) {
			project = state.projects.find(candidate => candidate.id === this.#requestedProjectId);
			if (!project) throw new Error(`Floyd Core project not found: ${this.#requestedProjectId}`);
		} else {
			project = state.projects.find(candidate => path.resolve(candidate.root_path) === this.#cwd);
		}
		if (project) {
			this.#projectId = project.id;
			return project.id;
		}
		const created = await this.#client.registerProject({ name: path.basename(this.#cwd), root_path: this.#cwd });
		this.#projectId = created.id;
		return created.id;
	}

	#enqueueInput(input: string): void {
		// Serialize rapid submissions instead of clearing and silently dropping
		// input while a previous Core lifecycle request is still resolving.
		this.#inputChain = this.#inputChain.then(() => this.#handleInput(input));
	}

	async #handleInput(input: string): Promise<void> {
		if (!input || this.#closed) return;
		try {
			if (input.startsWith("/")) await this.#handleCommand(input);
			else await this.#send(input);
		} catch (error) {
			this.#addError(displayError(error));
		} finally {
			this.#ui.requestRender();
		}
	}

	async #send(input: string): Promise<void> {
		this.#addUser(input);
		if (this.#sessionId) {
			await this.#client.steer(this.#sessionId, input, ACTOR);
			return;
		}
		if (!this.#projectId) throw new Error("Floyd Core project is not resolved.");
		const created = await this.#client.submit(this.#projectId, input);
		await this.#selectRun(created.run_id);
	}

	async #handleCommand(input: string): Promise<void> {
		const [command, ...args] = input.split(/\s+/);
		switch (command) {
			case "/help":
				this.#addSystem(
					"/status /new /run ID /answer ID TEXT /allow ID /always ID /deny ID /accept /reject /escalate /quit",
				);
				break;
			case "/status":
				await this.#showStatus();
				break;
			case "/new":
				await this.#detach();
				this.#runId = undefined;
				this.#sessionId = undefined;
				this.#addSystem("Ready for a new Floyd Core run.");
				break;
			case "/run":
				if (!args[0]) throw new Error("Usage: /run <id>");
				await this.#selectRun(args[0]);
				break;
			case "/answer":
				if (!this.#sessionId || !args[0] || args.length < 2) throw new Error("Usage: /answer <id> <answer>");
				await this.#client.answer(this.#sessionId, args[0], [[args.slice(1).join(" ")]], ACTOR);
				this.#addSystem(`Answer sent for ${args[0]}.`);
				break;
			case "/allow":
			case "/always":
			case "/deny": {
				if (!this.#sessionId || !args[0]) throw new Error(`Usage: ${command} <id>`);
				const reply = command === "/allow" ? "once" : command === "/always" ? "always" : "reject";
				await this.#client.permission(this.#sessionId, args[0], reply, ACTOR);
				this.#addSystem(`Permission response sent for ${args[0]}.`);
				break;
			}
			case "/accept":
			case "/reject":
			case "/escalate":
				if (!this.#runId) throw new Error("No active run.");
				await this.#client.decision(this.#runId, command.slice(1) as "accept" | "reject" | "escalate", ACTOR);
				this.#addSystem(`Decision recorded: ${command.slice(1)}.`);
				break;
			case "/quit":
				this.stop();
				break;
			default:
				throw new Error(`Unknown Floyd command: ${command}. Use /help.`);
		}
	}

	async #showStatus(): Promise<void> {
		const health = await this.#client.health();
		const run = this.#runId ? await this.#client.run(this.#runId) : undefined;
		this.#addSystem(
			`Core ${health.ok ? "online" : "offline"}; OpenCode ${health.engine.ok ? "online" : "offline"}; run ${run?.id ?? "none"}; status ${run?.status ?? "idle"}`,
		);
	}

	async #selectRun(runId: string): Promise<void> {
		const run = await this.#client.run(runId);
		if (!run.session_id) throw new Error(`Run ${runId} has no Core session.`);
		await this.#detach();
		this.#runId = run.id;
		this.#sessionId = run.session_id;
		this.#addSystem(`Attached to run ${run.id} (${run.status}).`);
		const controller = new AbortController();
		this.#streamAbort = controller;
		const task = this.#consumeStream(run.session_id, controller);
		this.#streamTask = task;
		void task.finally(() => {
			if (this.#streamTask === task) this.#streamTask = undefined;
		});
	}

	async #consumeStream(sessionId: string, controller: AbortController): Promise<void> {
		try {
			for await (const event of this.#client.attachSession(sessionId, ACTOR, { signal: controller.signal })) {
				if (controller.signal.aborted || this.#closed) break;
				this.#renderEvent(event);
			}
		} catch (error) {
			if (!controller.signal.aborted) this.#addError(displayError(error));
		} finally {
			if (this.#streamAbort === controller) this.#streamAbort = undefined;
			this.#ui.requestRender();
		}
	}

	#renderEvent(event: FloydStreamEvent): void {
		if (event.type === "hello") return;
		const payload = record(event.data);
		const data = record(payload.data);
		if (event.type === "token" && payload.channel === "text") {
			const delta = textValue(data.delta, textValue(data.text));
			if (!delta) return;
			if (!this.#assistantText) {
				this.#assistantText = new Text(`${chalk.hex("#8be9fd")("Floyd")}\n`, 1, 1);
				this.#addTranscript(this.#assistantText);
			}
			const next = `${this.#assistantText.getText()}${sanitizeTerminalText(delta)}`;
			this.#assistantText.setText(
				next.length <= MAX_ASSISTANT_CHARS
					? next
					: `${chalk.hex("#8be9fd")("Floyd")}\n[earlier streamed output truncated]\n${next.slice(-MAX_ASSISTANT_CHARS)}`,
			);
			this.#ui.requestRender();
			return;
		}
		this.#assistantText = undefined;
		if (event.type === "question") {
			this.#addEvent(`Question: ${safeDisplay(JSON.stringify(data))}\nUse /answer <id> <answer>.`);
		} else if (event.type === "permission") {
			this.#addEvent(
				`Permission: ${safeDisplay(JSON.stringify(data))}\nUse /allow, /always, or /deny with the request ID.`,
			);
		} else {
			this.#addEvent(`${event.type}: ${safeDisplay(JSON.stringify(data))}`);
		}
	}

	async #detach(): Promise<void> {
		const controller = this.#streamAbort;
		const task = this.#streamTask;
		if (!controller && !task) return;
		controller?.abort();
		await task;
		if (this.#streamAbort === controller) this.#streamAbort = undefined;
		if (this.#streamTask === task) this.#streamTask = undefined;
	}

	#addUser(text: string): void {
		this.#assistantText = undefined;
		this.#addTranscript(new Text(`${chalk.dim("You")}\n${safeDisplay(text)}`, 1, 1));
	}

	#addSystem(text: string): void {
		this.#assistantText = undefined;
		this.#addTranscript(new Text(chalk.dim(`Core\n${safeDisplay(text)}`), 1, 1));
		this.#ui.requestRender();
	}

	#addEvent(text: string): void {
		this.#assistantText = undefined;
		this.#addTranscript(new Text(chalk.hex("#ffb86c")(`Event\n${safeDisplay(text)}`), 1, 1));
		this.#ui.requestRender();
	}

	#addError(text: string): void {
		this.#assistantText = undefined;
		this.#addTranscript(new Text(chalk.hex("#ff5555")(`Core error\n${safeDisplay(text)}`), 1, 1));
		this.#ui.requestRender();
	}

	#addTranscript(component: Text): void {
		this.#transcript.addChild(component);
		while (this.#transcript.children.length > MAX_TRANSCRIPT_ITEMS) this.#transcript.children.shift();
	}
}
