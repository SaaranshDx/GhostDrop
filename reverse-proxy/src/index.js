import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import express from "express";

const app = express();

const TARGET_URL = process.env.TARGET_URL || "http://212.227.65.132:14796";
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

function buildUpstreamHeaders(headers) {
  const upstreamHeaders = new Headers();

  for (const [key, value] of Object.entries(headers)) {
    if (value == null || HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
      continue;
    }

    if (Array.isArray(value)) {
      for (const headerValue of value) {
        upstreamHeaders.append(key, headerValue);
      }
      continue;
    }

    upstreamHeaders.set(key, value);
  }

  return upstreamHeaders;
}

// CORS
app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "*");
  res.setHeader("Access-Control-Allow-Headers", "*");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  next();
});

app.all('/{*path}', async (req, res) => {
  const abortController = new AbortController();
  const abortUpstream = () => abortController.abort();
  const abortOnEarlyClose = () => {
    if (!res.writableEnded) {
      abortUpstream();
    }
  };

  req.on("aborted", abortUpstream);
  res.on("close", abortOnEarlyClose);

  try {
    const targetUrl = TARGET_URL + req.url;
    const hasRequestBody = !["GET", "HEAD"].includes(req.method);
    const requestBody = hasRequestBody ? Readable.toWeb(req) : undefined;

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: buildUpstreamHeaders(req.headers),
      body: requestBody,
      duplex: requestBody ? "half" : undefined,
      signal: abortController.signal,
    });

    res.status(response.status);

    response.headers.forEach((value, key) => {
      if (!HOP_BY_HOP_HEADERS.has(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    if (!response.body) {
      res.end();
      return;
    }

    await pipeline(Readable.fromWeb(response.body), res);
  } catch (err) {
    if (abortController.signal.aborted) {
      return;
    }

    if (res.headersSent) {
      res.destroy(err);
      return;
    }

    console.error("proxy failed:", err);
    res.status(500).json({ error: err.message });
  } finally {
    req.off("aborted", abortUpstream);
    res.off("close", abortOnEarlyClose);
  }
});

export default app;
