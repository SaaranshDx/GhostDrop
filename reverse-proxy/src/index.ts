const DEFAULT_TARGET_URL = "http://212.227.65.132:14796";

const HOP_BY_HOP_HEADERS = new Set([
	"connection",
	"keep-alive",
	"proxy-authenticate",
	"proxy-authorization",
	"te",
	"trailer",
	"transfer-encoding",
	"upgrade",
]);

type WorkerEnv = {
	TARGET_URL?: string;
};

function applyCorsHeaders(headers: Headers): void {
	headers.set("Access-Control-Allow-Origin", "*");
	headers.set("Access-Control-Allow-Methods", "*");
	headers.set("Access-Control-Allow-Headers", "*");
}

function buildUpstreamHeaders(requestHeaders: Headers): Headers {
	const upstreamHeaders = new Headers();

	for (const [key, value] of requestHeaders.entries()) {
		if (HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
			continue;
		}

		upstreamHeaders.set(key, value);
	}

	return upstreamHeaders;
}

function buildProxyUrl(requestUrl: string, targetBaseUrl: string): string {
	const incomingUrl = new URL(requestUrl);
	const upstreamUrl = new URL(targetBaseUrl);
	const basePath = upstreamUrl.pathname.replace(/\/$/, "");
	const requestPath = incomingUrl.pathname.startsWith("/")
		? incomingUrl.pathname
		: `/${incomingUrl.pathname}`;

	upstreamUrl.pathname = `${basePath}${requestPath}` || "/";
	upstreamUrl.search = incomingUrl.search;

	return upstreamUrl.toString();
}

function createPreflightResponse(): Response {
	const headers = new Headers();
	applyCorsHeaders(headers);

	return new Response(null, {
		status: 200,
		headers,
	});
}

function createErrorResponse(message: string, status = 500): Response {
	const headers = new Headers({ "content-type": "application/json" });
	applyCorsHeaders(headers);

	return new Response(JSON.stringify({ error: message }), {
		status,
		headers,
	});
}

async function proxyRequest(request: Request, env: WorkerEnv): Promise<Response> {
	if (request.method === "OPTIONS") {
		return createPreflightResponse();
	}

	const targetUrl = buildProxyUrl(request.url, env.TARGET_URL ?? DEFAULT_TARGET_URL);
	const hasRequestBody = request.method !== "GET" && request.method !== "HEAD";

	try {
		const upstreamResponse = await fetch(targetUrl, {
			method: request.method,
			headers: buildUpstreamHeaders(request.headers),
			body: hasRequestBody ? request.body : undefined,
			redirect: "follow",
			signal: request.signal,
		});

		const responseHeaders = new Headers();
		upstreamResponse.headers.forEach((value, key) => {
			if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
				responseHeaders.set(key, value);
			}
		});
		applyCorsHeaders(responseHeaders);

		return new Response(upstreamResponse.body, {
			status: upstreamResponse.status,
			statusText: upstreamResponse.statusText,
			headers: responseHeaders,
		});
	} catch (error) {
		if (request.signal.aborted) {
			return createErrorResponse("Request aborted", 499);
		}

		const message = error instanceof Error ? error.message : "Proxy request failed";
		console.error("proxy failed:", error);
		return createErrorResponse(message);
	}
}

export default {
	async fetch(request, env): Promise<Response> {
		return proxyRequest(request, env);
	},
} satisfies ExportedHandler<WorkerEnv>;
