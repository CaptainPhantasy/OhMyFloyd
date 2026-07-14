export const DEFAULT_FLOYD_CORE_URL = "http://127.0.0.1:41414";

export interface FloydProject {
	id: string;
	name: string;
	root_path: string;
}

export interface FloydRun {
	id: string;
	session_id: string;
	project_id: string;
	goal: string;
	status: string;
	jobs?: Array<Record<string, unknown>>;
	artifacts?: Array<Record<string, unknown>>;
}

export interface FloydHealth {
	ok: boolean;
	service: string;
	version: string;
	pid: number;
	engine: { ok: boolean; url: string; pid: number | null };
}

export interface FloydState {
	projects: FloydProject[];
	runs: FloydRun[];
	sessions: Array<Record<string, unknown>>;
	jobs: Array<Record<string, unknown>>;
	leases: Array<Record<string, unknown>>;
	provider_profiles: Array<Record<string, unknown>>;
}

export interface FloydStreamEvent<T = unknown> {
	id?: string;
	type: string;
	data: T;
}

export interface FloydClientOptions {
	baseUrl?: string;
	token: string | (() => string | Promise<string>);
	fetch?: FloydFetch;
}

export type FloydFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export class FloydApiError extends Error {
	readonly status: number;
	readonly method: string;
	readonly path: string;
	readonly payload: unknown;

	constructor(method: string, path: string, status: number, payload: unknown) {
		const detail = typeof payload === "string" ? payload : JSON.stringify(payload);
		super(`${method} ${path} -> ${status}: ${detail}`);
		this.name = "FloydApiError";
		this.status = status;
		this.method = method;
		this.path = path;
		this.payload = payload;
	}
}

/** Dependency-free client boundary. Provider credentials never cross it. */
export class FloydClient {
	readonly baseUrl: string;
	#tokenSource: FloydClientOptions["token"];
	#fetch: FloydFetch;

	constructor(options: FloydClientOptions) {
		this.baseUrl = (options.baseUrl ?? DEFAULT_FLOYD_CORE_URL).replace(/\/+$/, "");
		this.#tokenSource = options.token;
		this.#fetch = (options.fetch ?? globalThis.fetch).bind(globalThis);
	}

	async #token(): Promise<string> {
		return typeof this.#tokenSource === "function" ? this.#tokenSource() : this.#tokenSource;
	}

	async request<T>(method: string, path: string, body?: unknown, signal?: AbortSignal): Promise<T> {
		const response = await this.#fetch(`${this.baseUrl}${path}`, {
			method,
			headers: {
				authorization: `Bearer ${await this.#token()}`,
				...(body === undefined ? {} : { "content-type": "application/json" }),
			},
			body: body === undefined ? undefined : JSON.stringify(body),
			signal,
		});
		const text = await response.text();
		let payload: unknown = text;
		if (text) {
			try {
				payload = JSON.parse(text);
			} catch {
				// Exact non-JSON Core bodies are part of the error contract.
			}
		}
		if (!response.ok) throw new FloydApiError(method, path, response.status, payload);
		return payload as T;
	}

	health(signal?: AbortSignal): Promise<FloydHealth> {
		return this.request("GET", "/api/health", undefined, signal);
	}

	state(signal?: AbortSignal): Promise<FloydState> {
		return this.request("GET", "/api/state", undefined, signal);
	}

	registerProject(
		input: { name: string; root_path: string; test_command?: string },
		signal?: AbortSignal,
	): Promise<{ id: string }> {
		return this.request("POST", "/api/projects", input, signal);
	}

	submit(projectId: string, goal: string, signal?: AbortSignal): Promise<{ run_id: string; duplicate: boolean }> {
		return this.request("POST", "/api/runs", { project_id: projectId, goal }, signal);
	}

	run(runId: string, signal?: AbortSignal): Promise<FloydRun> {
		return this.request("GET", `/api/runs/${encodeURIComponent(runId)}`, undefined, signal);
	}

	steer(sessionId: string, text: string, actor: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
		return this.request(
			"POST",
			`/api/sessions/${encodeURIComponent(sessionId)}/steer`,
			{ type: "steer", text, actor },
			signal,
		);
	}

	answer(
		sessionId: string,
		requestId: string,
		answers: string[][],
		actor: string,
		signal?: AbortSignal,
	): Promise<Record<string, unknown>> {
		return this.request(
			"POST",
			`/api/sessions/${encodeURIComponent(sessionId)}/steer`,
			{ type: "answer", request_id: requestId, answers, actor },
			signal,
		);
	}

	permission(
		sessionId: string,
		requestId: string,
		reply: "once" | "always" | "reject",
		actor: string,
		signal?: AbortSignal,
	): Promise<Record<string, unknown>> {
		return this.request(
			"POST",
			`/api/sessions/${encodeURIComponent(sessionId)}/steer`,
			{ type: "permission", request_id: requestId, reply, actor },
			signal,
		);
	}

	decision(
		runId: string,
		action: "accept" | "reject" | "escalate",
		actor: string,
		signal?: AbortSignal,
	): Promise<Record<string, unknown>> {
		return this.request("POST", `/api/runs/${encodeURIComponent(runId)}/decision`, { action, actor }, signal);
	}

	async *stream(
		path: string,
		options: { method?: "GET" | "POST"; body?: unknown; lastEventId?: string; signal?: AbortSignal } = {},
	): AsyncGenerator<FloydStreamEvent> {
		const response = await this.#fetch(`${this.baseUrl}${path}`, {
			method: options.method ?? "GET",
			headers: {
				authorization: `Bearer ${await this.#token()}`,
				accept: "text/event-stream",
				...(options.body === undefined ? {} : { "content-type": "application/json" }),
				...(options.lastEventId ? { "last-event-id": options.lastEventId } : {}),
			},
			body: options.body === undefined ? undefined : JSON.stringify(options.body),
			signal: options.signal,
		});
		if (!response.ok || !response.body) {
			const text = await response.text().catch(() => "");
			let payload: unknown = text;
			try {
				payload = JSON.parse(text);
			} catch {
				// Preserve exact error text.
			}
			throw new FloydApiError(options.method ?? "GET", path, response.status, payload);
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		try {
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true }).replace(/\r\n?/g, "\n");
				const frames = buffer.split("\n\n");
				buffer = frames.pop() ?? "";
				for (const frame of frames) {
					let id: string | undefined;
					let type = "message";
					const dataLines: string[] = [];
					for (const line of frame.split("\n")) {
						if (line.startsWith("id:")) id = line.slice(3).trim();
						else if (line.startsWith("event:")) type = line.slice(6).trim();
						else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
					}
					if (dataLines.length === 0) continue;
					const raw = dataLines.join("\n");
					let data: unknown = raw;
					try {
						data = JSON.parse(raw);
					} catch {
						// Plain-text SSE is valid.
					}
					yield { ...(id ? { id } : {}), type, data };
				}
			}
			buffer += decoder.decode().replace(/\r\n?/g, "\n");
			if (buffer.trim()) {
				let id: string | undefined;
				let type = "message";
				const dataLines: string[] = [];
				for (const line of buffer.split("\n")) {
					if (line.startsWith("id:")) id = line.slice(3).trim();
					else if (line.startsWith("event:")) type = line.slice(6).trim();
					else if (line.startsWith("data:")) dataLines.push(line.slice(5).trimStart());
				}
				if (dataLines.length > 0) {
					const raw = dataLines.join("\n");
					let data: unknown = raw;
					try {
						data = JSON.parse(raw);
					} catch {
						// Plain-text SSE is valid.
					}
					yield { ...(id ? { id } : {}), type, data };
				}
			}
		} finally {
			// Iterator break and AbortSignal both release the Core response immediately.
			await reader.cancel().catch(() => {});
			reader.releaseLock();
		}
	}

	attachSession(
		sessionId: string,
		actor: string,
		options: { lastEventId?: string; signal?: AbortSignal } = {},
	): AsyncGenerator<FloydStreamEvent> {
		return this.stream(`/api/sessions/${encodeURIComponent(sessionId)}/attach`, {
			method: "POST",
			body: { actor },
			lastEventId: options.lastEventId,
			signal: options.signal,
		});
	}
}
