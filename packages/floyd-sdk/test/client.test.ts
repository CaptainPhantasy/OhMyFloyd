import { afterEach, describe, expect, test } from "bun:test";
import { FloydApiError, FloydClient } from "../src";

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
});
