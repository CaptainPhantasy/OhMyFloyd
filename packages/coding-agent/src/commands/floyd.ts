import { Args, Command, Flags } from "@oh-my-pi/pi-utils/cli";
import { createFloydClient } from "../floyd-core/client";
import { FloydCoreMode } from "../floyd-core/mode";

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
		print: Flags.boolean({ char: "p", description: "Submit the goal without opening the TUI", default: false }),
	};

	async run(): Promise<void> {
		const { args, flags } = await this.parse(Floyd);
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
		const mode = new FloydCoreMode({ client, cwd: process.cwd(), projectId: flags["project-id"] });
		await mode.run(message || undefined);
	}
}
