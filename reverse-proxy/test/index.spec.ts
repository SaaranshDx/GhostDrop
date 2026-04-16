import { afterEach, describe, expect, it, vi } from "vitest";

const { connectMock } = vi.hoisted(() => ({
	connectMock: vi.fn(),
}));

vi.mock("cloudflare:sockets", () => ({
	connect: connectMock,
}));

import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
	connectMock.mockReset();
});

describe("reverse proxy worker", () => {
	it("handles CORS preflight without calling upstream", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);

		const request = new IncomingRequest("http://example.com/api/files", {
			method: "OPTIONS",
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, { TARGET_URL: env.TARGET_URL }, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(connectMock).not.toHaveBeenCalled();
	});

	it("uses fetch for supported upstream ports", async () => {
		const targetUrl = "http://example-upstream.test:8080";
		const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
			const upstreamRequest = new Request(input, init);

			expect(upstreamRequest.url).toBe(`${targetUrl}/api/files?folder=alpha`);
			expect(upstreamRequest.method).toBe("POST");
			expect(upstreamRequest.headers.get("x-test")).toBe("1");
			expect(upstreamRequest.headers.get("connection")).toBeNull();
			expect(await upstreamRequest.text()).toBe('{"hello":"world"}');

			return new Response("proxied", {
				status: 201,
				headers: {
					"content-type": "text/plain",
					"connection": "keep-alive",
					"x-upstream": "ok",
				},
			});
		});
		vi.stubGlobal("fetch", fetchSpy);

		const request = new IncomingRequest("http://example.com/api/files?folder=alpha", {
			method: "POST",
			headers: {
				"content-type": "application/json",
				"connection": "keep-alive",
				"x-test": "1",
			},
			body: JSON.stringify({ hello: "world" }),
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, { TARGET_URL: targetUrl }, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(201);
		expect(response.headers.get("x-upstream")).toBe("ok");
		expect(response.headers.get("connection")).toBeNull();
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(await response.text()).toBe("proxied");
		expect(connectMock).not.toHaveBeenCalled();
	});

	it("uses TCP sockets for non-standard upstream ports", async () => {
		const decoder = new TextDecoder();
		const socketClose = vi.fn();
		let writtenRequest = "";

		connectMock.mockReturnValue({
			readable: new ReadableStream<Uint8Array>({
				start(controller) {
					controller.enqueue(
						new TextEncoder().encode(
							"HTTP/1.0 200 OK\r\nContent-Type: text/plain\r\nConnection: close\r\nX-Upstream: socket\r\n\r\nsocket proxied"
						)
					);
					controller.close();
				},
			}),
			writable: new WritableStream<Uint8Array>({
				write(chunk) {
					writtenRequest += decoder.decode(chunk, { stream: true });
				},
			}),
			close: socketClose,
		});

		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);

		const request = new IncomingRequest("http://example.com/socket-check?folder=beta", {
			headers: {
				"x-test": "socket",
			},
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(
			request,
			{ TARGET_URL: "http://212.227.65.132:14796" },
			ctx
		);
		await waitOnExecutionContext(ctx);

		expect(connectMock).toHaveBeenCalledWith(
			{ hostname: "212.227.65.132", port: 14796 },
			{ secureTransport: "off" }
		);
		expect(fetchSpy).not.toHaveBeenCalled();
		expect(writtenRequest).toContain("GET /socket-check?folder=beta HTTP/1.0");
		expect(writtenRequest).toContain("host: 212.227.65.132:14796");
		expect(writtenRequest).toContain("x-test: socket");
		expect(response.status).toBe(200);
		expect(response.headers.get("x-upstream")).toBe("socket");
		expect(response.headers.get("connection")).toBeNull();
		expect(await response.text()).toBe("socket proxied");
		expect(socketClose).toHaveBeenCalled();
	});
});
