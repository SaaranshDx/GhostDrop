import express from "express";

const app = express();

const TARGET_URL = process.env.TARGET_URL || "http://212.227.65.132:14796";

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

// raw body
app.use(express.raw({ type: "*/*", limit: "100mb" }));

app.all('/{*path}', async (req, res) => {
  try {
    const targetUrl = TARGET_URL + req.url;

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        ...req.headers,
        host: new URL(TARGET_URL).host,
      },
      body:
        req.method !== "GET" && req.method !== "HEAD"
          ? req.body
          : undefined,
    });

    res.status(response.status);

    response.headers.forEach((value, key) => {
      if (!["transfer-encoding", "connection"].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });

    const buffer = await response.arrayBuffer();
    res.send(Buffer.from(buffer));
  } catch (err) {
    console.error("proxy failed:", err);
    res.status(500).json({ error: err.message });
  }
});

export default app;