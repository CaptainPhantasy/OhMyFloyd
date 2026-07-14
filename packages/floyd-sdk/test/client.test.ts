import { afterEach, describe, expect, test } from "bun:test";
import { FLOYD_EXPERIENCE_VERSION, FLOYD_SDK_PROTOCOL_VERSION, FloydApiError, FloydClient } from "../src";

const servers: Bun.Server<undefined>[] = [];

afterEach(() => {
	for (const server of servers.splice(0)) server.stop(true);
});

function serve(fetch: (request: Request) => Response | Promise<Response>): Bun.Server<undefined> {
	const server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch });
	servers.push(server);
	return server;
}

describe("FloydClient", () => {
	test("sends only the Core bearer token and preserves exact upstream errors", async () => {
		let authorization = "";
		const server = serve(request => {
			authorization = request.headers.get("authorization") ?? "";
			return Response.json({ error: "rate_limited", retry_after: 17 }, { status: 429 });
		});
		const client = new FloydClient({ baseUrl: server.url.origin, token: "core-secret" });
		let caught: unknown;
		try {
			await client.health();
		} catch (error) {
			caught = error;
		}
		expect(authorization).toBe("Bearer core-secret");
		expect(caught).toBeInstanceOf(FloydApiError);
		expect(caught).toMatchObject({ status: 429, payload: { error: "rate_limited", retry_after: 17 } });
	});

	test("parses Core SSE frames and cancels the response reader when the consumer detaches", async () => {
		let cancelled = false;
		const encoder = new TextEncoder();
		const response = new Response(
			new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(
						encoder.encode('id: evt_1\nevent: token\ndata: {"channel":"text","data":{"delta":"Floyd"}}\n\n'),
					);
				},
				cancel() {
					cancelled = true;
				},
			}),
			{ headers: { "content-type": "text/event-stream" } },
		);
		const fetchStub = async () => response;
		const client = new FloydClient({ baseUrl: "http://core.test", token: "core-secret", fetch: fetchStub });
		for await (const event of client.attachSession("session one", "test")) {
			expect(event).toEqual({
				id: "evt_1",
				type: "token",
				data: { channel: "text", data: { delta: "Floyd" } },
			});
			break;
		}
		expect(cancelled).toBeTrue();
	});

	test("propagates AbortSignal cancellation to the Core request", async () => {
		let requestAborted = false;
		const server = serve(request => {
			request.signal.addEventListener("abort", () => {
				requestAborted = true;
			});
			return new Response(new ReadableStream({ start() {} }), {
				headers: { "content-type": "text/event-stream" },
			});
		});
		const client = new FloydClient({ baseUrl: server.url.origin, token: "core-secret" });
		const controller = new AbortController();
		const iterator = client.attachSession("session", "test", { signal: controller.signal });
		const pending = iterator.next().catch(error => error);
		await Bun.sleep(10);
		controller.abort();
		await pending;
		await Bun.sleep(10);
		expect(requestAborted).toBeTrue();
	});

	test("uses the portable Experience endpoints and carries the run identity on steer", async () => {
		const requests: Array<{ method: string; pathname: string; headers: Headers; body: unknown }> = [];
		const fetchStub = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			const url = new URL(input instanceof Request ? input.url : String(input));
			const body = init?.body ? JSON.parse(String(init.body)) : undefined;
			requests.push({
				method: init?.method ?? "GET",
				pathname: url.pathname,
				headers: new Headers(init?.headers),
				body,
			});
			if (url.pathname === "/api/experience/negotiate") {
				return Response.json({
					accepted: true,
					envelope_version: FLOYD_EXPERIENCE_VERSION,
					core_protocol_version: FLOYD_SDK_PROTOCOL_VERSION,
					minimum_sdk_version: FLOYD_SDK_PROTOCOL_VERSION,
				});
			}
			return Response.json({ ok: true });
		};
		const client = new FloydClient({ baseUrl: "http://core.test", token: "core-secret", fetch: fetchStub });
		await client.negotiateExperience({ surface_id: "test-surface", capabilities: ["experience-read"] });
		await client.experience("team one");
		await client.updateExperience("team one", { expected_revision: 7, composer_draft: "next" });
		await client.steer("session one", "continue", "test", undefined, "run one");

		expect(requests.map(request => `${request.method} ${request.pathname}`)).toEqual([
			"POST /api/experience/negotiate",
			"GET /api/experience/team%20one",
			"PATCH /api/experience/team%20one",
			"POST /api/sessions/session%20one/steer",
		]);
		expect(requests[0]?.body).toEqual({
			surface_id: "test-surface",
			sdk_version: FLOYD_SDK_PROTOCOL_VERSION,
			supported_envelope_versions: [FLOYD_EXPERIENCE_VERSION],
			capabilities: ["experience-read"],
		});
		expect(requests[3]?.body).toMatchObject({ type: "steer", run_id: "run one" });
		expect(requests.every(request => request.headers.get("authorization") === "Bearer core-secret")).toBeTrue();
	});

	test("resumes the Experience stream by revision and cancels on detach", async () => {
		let path = "";
		let lastEventId = "";
		let cancelled = false;
		const encoder = new TextEncoder();
		const fetchStub = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
			path = new URL(input instanceof Request ? input.url : String(input)).pathname;
			lastEventId = new Headers(init?.headers).get("last-event-id") ?? "";
			return new Response(
				new ReadableStream<Uint8Array>({
					start(controller) {
						controller.enqueue(encoder.encode('id: 12\nevent: experience\ndata: {"revision":12}\n\n'));
					},
					cancel() {
						cancelled = true;
					},
				}),
				{ headers: { "content-type": "text/event-stream" } },
			);
		};
		const client = new FloydClient({ baseUrl: "http://core.test", token: "core-secret", fetch: fetchStub });
		for await (const event of client.watchExperience("team one", { lastEventId: "11" })) {
			expect(event).toMatchObject({ id: "12", type: "experience", data: { revision: 12 } });
			break;
		}
		expect(path).toBe("/api/experience/team%20one/stream");
		expect(lastEventId).toBe("11");
		expect(cancelled).toBeTrue();
	});
});
