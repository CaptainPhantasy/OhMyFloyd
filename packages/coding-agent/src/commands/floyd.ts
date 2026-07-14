import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { createFloydClient } from "../floyd-core/client";
import { FloydCoreMode, type FloydHandoffSelection } from "../floyd-core/mode";

export function parseFloydHandoff(
	sessionId: string | undefined,
	runId: string | undefined,
	lastEventId: string | undefined,
): FloydHandoffSelection | undefined {
	if (!sessionId && !runId && !lastEventId) return undefined;
	if (!sessionId || !runId) throw new Error("Floyd handoff requires both --session and --run.");
	if (/[\r\n]/.test(sessionId) || /[\r\n]/.test(runId) || (lastEventId && /[\r\n]/.test(lastEventId))) {
		throw new Error("Floyd handoff identifiers must not contain line breaks.");
	}
	if (lastEventId !== undefined && !/^(0|[1-9]\d*)$/.test(lastEventId)) {
		throw new Error("--event must be a non-negative integer Floyd event ID.");
	}
	return { sessionId, runId, lastEventId };
}

export default class Floyd extends Command {
	static description = "Natural-language coding partner powered by Floyd Core and managed OpenCode";

	static args = {
		messages: Args.string({ description: "Natural-language coding goal", required: false, multiple: true }),
	};

	static flags = {
		status: Flags.boolean({ description: "Print Core and OpenCode health, then exit", default: false }),
		json: Flags.boolean({ char: "j", description: "Print machine-readable output", default: false }),
		"base-url": Flags.string({ description: "Floyd Core loopback URL" }),
		"runtime-root": Flags.string({ description: "Floyd runtime root containing the Core gateway token" }),
		"project-id": Flags.string({ description: "Existing Floyd Core project ID" }),
		session: Flags.string({ description: "Exact Floyd Core session ID from a handoff" }),
		run: Flags.string({ description: "Exact Floyd Core run ID from a handoff" }),
		event: Flags.string({ description: "Last received event ID from a handoff" }),
		print: Flags.boolean({ char: "p", description: "Submit the goal without opening the TUI", default: false }),
		continue: Flags.boolean({
			description: "Continue the matching active Floyd experience when a goal is supplied",
			default: false,
		}),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Floyd);
		const handoff = parseFloydHandoff(flags.session, flags.run, flags.event);
		if (handoff && (flags.status || flags.print)) {
			throw new Error("--session, --run, and --event are only valid in interactive Floyd mode.");
		}
		const client = createFloydClient({ baseUrl: flags["base-url"], runtimeRoot: flags["runtime-root"] });
		if (flags.status) {
			const health = await client.health();
			const output = flags.json
				? JSON.stringify(health)
				: `Floyd Core ${health.ok ? "online" : "offline"}; OpenCode ${health.engine.ok ? "online" : "offline"}`;
			process.stdout.write(`${output}\n`);
			return;
		}

		const message = args.messages?.join(" ").trim() ?? "";
		if (flags.print) {
			if (flags.continue) throw new Error("--continue is only valid in interactive Floyd mode.");
			if (!message) throw new Error("--print requires a natural-language coding goal.");
			const mode = new FloydCoreMode({ client, cwd: process.cwd(), projectId: flags["project-id"] });
			const projectId = await mode.resolveProject();
			const submitted = await client.submit(projectId, message);
			const run = await client.run(submitted.run_id);
			process.stdout.write(`${flags.json ? JSON.stringify(run) : `Floyd run ${run.id} ${run.status}`}\n`);
			return;
		}
		if (!process.stdin.isTTY || !process.stdout.isTTY) {
			throw new Error("Interactive Floyd mode requires a TTY. Supply a goal or use --status.");
		}
		const mode = new FloydCoreMode({
			client,
			cwd: process.cwd(),
			projectId: flags["project-id"],
			continueActive: flags.continue,
			handoff,
		});
		await mode.run(message || undefined);
	}
}
