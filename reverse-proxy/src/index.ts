import { connect } from "cloudflare:sockets";

const DEFAULT_TARGET_URL = "http://212.227.65.132:14796";
const FETCH_HTTP_PORTS = new Set([80, 8080, 8880, 2052, 2082, 2086, 2095]);
const FETCH_HTTPS_PORTS = new Set([443, 2053, 2083, 2087, 2096, 8443]);
const NO_RESPONSE_BODY_STATUS_CODES = new Set([101, 204, 205, 304]);

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

function resolveTargetPort(targetUrl: URL): number {
	if (targetUrl.port) {
		return Number(targetUrl.port);
	}

	return targetUrl.protocol === "https:" ? 443 : 80;
}

function shouldUseSocketProxy(targetUrl: URL): boolean {
	const port = resolveTargetPort(targetUrl);

	if (targetUrl.protocol === "http:") {
		return !FETCH_HTTP_PORTS.has(port);
	}

	if (targetUrl.protocol === "https:") {
		return !FETCH_HTTPS_PORTS.has(port);
	}

	return false;
}

function buildTargetHostHeader(targetUrl: URL): string {
	const defaultPort = targetUrl.protocol === "https:" ? "443" : "80";

	if (!targetUrl.port || targetUrl.port === defaultPort) {
		return targetUrl.hostname;
	}

	return `${targetUrl.hostname}:${targetUrl.port}`;
}

function buildTargetPath(targetUrl: URL): string {
	const pathname = targetUrl.pathname || "/";
	return `${pathname}${targetUrl.search}`;
}

function concatenateChunks(chunks: Uint8Array[]): Uint8Array {
	const totalLength = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const result = new Uint8Array(totalLength);
	let offset = 0;

	for (const chunk of chunks) {
		result.set(chunk, offset);
		offset += chunk.byteLength;
	}

	return result;
}

function findHeaderTerminator(buffer: Uint8Array): number {
	for (let index = 0; index <= buffer.length - 4; index += 1) {
		if (
			buffer[index] === 13 &&
			buffer[index + 1] === 10 &&
			buffer[index + 2] === 13 &&
			buffer[index + 3] === 10
		) {
			return index;
		}
	}

	return -1;
}

async function buildSocketRequestPayload(request: Request, targetUrl: URL): Promise<Uint8Array> {
	const headers = buildUpstreamHeaders(request.headers);
	const hasRequestBody = request.method !== "GET" && request.method !== "HEAD";
	let bodyBytes = new Uint8Array();

	headers.set("host", buildTargetHostHeader(targetUrl));
	headers.set("connection", "close");

	if (hasRequestBody) {
		bodyBytes = request.body ? new Uint8Array(await request.arrayBuffer()) : new Uint8Array();
		headers.set("content-length", String(bodyBytes.byteLength));
	} else {
		headers.delete("content-length");
	}

	let requestHead = `${request.method} ${buildTargetPath(targetUrl)} HTTP/1.0\r\n`;
	headers.forEach((value, key) => {
		requestHead += `${key}: ${value}\r\n`;
	});
	requestHead += "\r\n";

	const encoder = new TextEncoder();
	const headBytes = encoder.encode(requestHead);

	return bodyBytes.byteLength > 0
		? concatenateChunks([headBytes, bodyBytes])
		: headBytes;
}

async function readSocketResponseHead(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<{
	head: Uint8Array;
	leftoverBody: Uint8Array;
}> {
	const chunks: Uint8Array[] = [];

	while (true) {
		const { done, value } = await reader.read();
		if (done || !value) {
			break;
		}

		chunks.push(value);
		const combined = concatenateChunks(chunks);
		const headerEnd = findHeaderTerminator(combined);
		if (headerEnd !== -1) {
			return {
				head: combined.slice(0, headerEnd),
				leftoverBody: combined.slice(headerEnd + 4),
			};
		}
	}

	throw new Error("Upstream closed connection before sending response headers");
}

function parseSocketResponseHead(headBytes: Uint8Array): {
	status: number;
	statusText: string;
	headers: Headers;
} {
	const headerText = new TextDecoder().decode(headBytes);
	const lines = headerText.split("\r\n");
	const statusLine = lines.shift();

	if (!statusLine) {
		throw new Error("Upstream response did not include a status line");
	}

	const match = statusLine.match(/^HTTP\/\d+\.\d+\s+(\d{3})(?:\s+(.*))?$/);
	if (!match) {
		throw new Error(`Invalid upstream status line: ${statusLine}`);
	}

	const headers = new Headers();
	for (const line of lines) {
		if (!line) {
			continue;
		}

		const separatorIndex = line.indexOf(":");
		if (separatorIndex === -1) {
			continue;
		}

		const key = line.slice(0, separatorIndex).trim();
		const value = line.slice(separatorIndex + 1).trim();
		headers.append(key, value);
	}

	return {
		status: Number(match[1]),
		statusText: match[2] ?? "",
		headers,
	};
}

function createSocketBodyStream(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	initialChunk: Uint8Array,
	closeSocket: () => void
): ReadableStream<Uint8Array> {
	let initialChunkDelivered = false;

	return new ReadableStream<Uint8Array>({
		pull: async (controller) => {
			if (!initialChunkDelivered) {
				initialChunkDelivered = true;
				if (initialChunk.byteLength > 0) {
					controller.enqueue(initialChunk);
					return;
				}
			}

			const { done, value } = await reader.read();
			if (done) {
				closeSocket();
				reader.releaseLock();
				controller.close();
				return;
			}

			controller.enqueue(value);
		},
		cancel: async (reason) => {
			try {
				await reader.cancel(reason);
			} finally {
				closeSocket();
			}
		},
	});
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

async function proxyWithFetch(request: Request, targetUrl: string): Promise<Response> {
	const hasRequestBody = request.method !== "GET" && request.method !== "HEAD";
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
}

async function proxyWithSocket(request: Request, targetUrl: URL): Promise<Response> {
	const socket = connect(
		{ hostname: targetUrl.hostname, port: resolveTargetPort(targetUrl) },
		{ secureTransport: targetUrl.protocol === "https:" ? "on" : "off" }
	);

	try {
		const writer = socket.writable.getWriter();
		try {
			await writer.write(await buildSocketRequestPayload(request, targetUrl));
		} finally {
			await writer.close();
			writer.releaseLock();
		}

		const reader = socket.readable.getReader();
		const { head, leftoverBody } = await readSocketResponseHead(reader);
		const upstreamResponse = parseSocketResponseHead(head);
		const responseHeaders = new Headers();
		upstreamResponse.headers.forEach((value, key) => {
			if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
				responseHeaders.append(key, value);
			}
		});
		applyCorsHeaders(responseHeaders);

		const hasResponseBody =
			request.method !== "HEAD" && !NO_RESPONSE_BODY_STATUS_CODES.has(upstreamResponse.status);
		const body = hasResponseBody
			? createSocketBodyStream(reader, leftoverBody, () => socket.close())
			: null;

		if (!hasResponseBody) {
			await reader.cancel();
			socket.close();
		}

		return new Response(body, {
			status: upstreamResponse.status,
			statusText: upstreamResponse.statusText,
			headers: responseHeaders,
		});
	} catch (error) {
		socket.close();
		throw error;
	}
}

async function proxyRequest(request: Request, env: WorkerEnv): Promise<Response> {
	if (request.method === "OPTIONS") {
		return createPreflightResponse();
	}

	const targetUrl = new URL(buildProxyUrl(request.url, env.TARGET_URL ?? DEFAULT_TARGET_URL));

	try {
		if (shouldUseSocketProxy(targetUrl)) {
			return await proxyWithSocket(request, targetUrl);
		}

		return await proxyWithFetch(request, targetUrl.toString());
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
