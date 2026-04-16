import { env, createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";

const IncomingRequest = Request<unknown, IncomingRequestCfProperties>;

afterEach(() => {
	vi.restoreAllMocks();
	vi.unstubAllGlobals();
});

describe("reverse proxy worker", () => {
	it("handles CORS preflight without calling upstream", async () => {
		const fetchSpy = vi.fn();
		vi.stubGlobal("fetch", fetchSpy);

		const request = new IncomingRequest("http://example.com/api/files", {
			method: "OPTIONS",
		});
		const ctx = createExecutionContext();
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(200);
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(fetchSpy).not.toHaveBeenCalled();
	});

	it("forwards requests and filters hop-by-hop headers", async () => {
		const targetUrl = "http://212.227.65.132:14796";
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
		const response = await worker.fetch(request, env, ctx);
		await waitOnExecutionContext(ctx);

		expect(response.status).toBe(201);
		expect(response.headers.get("x-upstream")).toBe("ok");
		expect(response.headers.get("connection")).toBeNull();
		expect(response.headers.get("Access-Control-Allow-Origin")).toBe("*");
		expect(await response.text()).toBe("proxied");
	});
});
