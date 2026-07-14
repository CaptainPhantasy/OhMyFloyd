import { join } from "node:path";
import { FloydClient } from "@floyd/sdk";

const DEFAULT_RUNTIME_ROOT = "/Volumes/Storage/FLOYD_RUNTIME";

export interface FloydConnectionOptions {
	baseUrl?: string;
	runtimeRoot?: string;
}

/**
 * Build the sole client boundary used by OhMyFloyd. The file is a Floyd Core
 * loopback token, not a provider credential, and is never copied into UI state.
 */
export function createFloydClient(options: FloydConnectionOptions): FloydClient {
	const runtimeRoot = options.runtimeRoot ?? process.env.FLOYD_RUNTIME_ROOT ?? DEFAULT_RUNTIME_ROOT;
	const tokenPath = join(runtimeRoot, "core", "gateway.token");
	return new FloydClient({
		baseUrl: options.baseUrl ?? process.env.FLOYD_CORE_URL,
		token: async () => {
			try {
				return (await Bun.file(tokenPath).text()).trim();
			} catch (error) {
				throw new Error(`Cannot read Floyd Core token at ${tokenPath}. Start floyd-core first.`, { cause: error });
			}
		},
	});
}
