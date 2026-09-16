// api/_doku.ts
import crypto from "node:crypto";
function getDokuClientId() {
  return (process.env.DOKU_CLIENT_ID || process.env.DOKU_SANDBOX_CLIENT_ID || "").replace(/["']/g, "").trim();
}
function getDokuSecretKey() {
  return (process.env.DOKU_SECRET_KEY || process.env.DOKU_SANDBOX_SECRET_KEY || "").replace(/["']/g, "").trim();
}
function generateDigest(body) {
  const content = typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body);
  return crypto.createHash("sha256").update(content).digest("base64");
}
function generateSignature(clientId, requestId, requestTimestamp, requestTarget, digest, secretKey) {
  const componentSignature = `Client-Id:${clientId}
Request-Id:${requestId}
Request-Timestamp:${requestTimestamp}
Request-Target:${requestTarget}
Digest:${digest}`;
  const hmac = crypto.createHmac("sha256", secretKey);
  hmac.update(componentSignature, "utf8");
  const hmacBase64 = hmac.digest("base64");
  return `HMACSHA256=${hmacBase64}`;
}
function verifyDokuWebhookSignature(headers, rawBody, requestTarget, now = Date.now()) {
  const secretKey = getDokuSecretKey();
  if (!secretKey) return false;
  const getHeader = (key) => {
    const matches = Object.entries(headers).filter(([name]) => name.toLowerCase() === key.toLowerCase());
    if (matches.length !== 1) return "";
    const val = matches[0][1];
    if (Array.isArray(val)) return "";
    return typeof val === "string" ? val : "";
  };
  const clientId = getHeader("Client-Id");
  const requestId = getHeader("Request-Id");
  const requestTimestamp = getHeader("Request-Timestamp");
  const incomingSignature = getHeader("Signature");
  if (!clientId || clientId !== getDokuClientId() || !requestId || !requestTimestamp || !incomingSignature) {
    return false;
  }
  if (!/^[\x21-\x7e]{1,128}$/.test(requestId) || requestId.includes(",")) return false;
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(requestTimestamp)) return false;
  const time = Date.parse(requestTimestamp);
  if (!Number.isFinite(time) || new Date(time).toISOString().replace(".000Z", "Z") !== requestTimestamp.replace(".000Z", "Z")) return false;
  if (time > now + 5 * 6e4 || now - time > 13 * 60 * 6e4) return false;
  const digest = generateDigest(rawBody);
  const expectedSignature = generateSignature(
    clientId,
    requestId,
    requestTimestamp,
    requestTarget,
    digest,
    secretKey
  );
  try {
    const bufA = Buffer.from(incomingSignature, "utf8");
    const bufB = Buffer.from(expectedSignature, "utf8");
    if (bufA.length !== bufB.length) return false;
    return crypto.timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
}

// src/server/dokuHandler.ts
async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, Client-Id, Request-Id, Request-Timestamp, Signature");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  const rawBody = typeof req.body === "string" ? req.body : JSON.stringify(req.body || {});
  const isValid = verifyDokuWebhookSignature(req.headers, rawBody, "/api/v1/webhooks/doku");
  console.log("[DOKU Serverless Webhook Received]", {
    isValid,
    body: req.body
  });
  return res.status(200).json({
    ok: true,
    message: "Webhook processed successfully"
  });
}
export {
  handler as default
};
