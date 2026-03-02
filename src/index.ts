/**
 * easyx402 — Pay-per-query AI chat on Injective DeFi markets
 *
 * Routes:
 *   GET  /       → chat frontend
 *   GET  /config → public config (no secrets)
 *   POST /ask    → x402-gated: live Injective data + Claude
 */

import path from "path";
import { fileURLToPath } from "url";
import express from "express";
import Anthropic from "@anthropic-ai/sdk";
import { injectivePaymentMiddleware } from "@x402/injective";
import { gatherContext } from "./injective.js";

// ─── Bootstrap ────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

if (!process.env.PRIVATE_KEY) {
  console.error("PRIVATE_KEY is required — see .env.example");
  process.exit(1);
}
if (!process.env.ANTHROPIC_API_KEY) {
  console.error("ANTHROPIC_API_KEY is required — see .env.example");
  process.exit(1);
}

const WUSDT_ADDRESS = (
  process.env.WRAPPED_USDT_ADDRESS ??
  "0xfdd13887b73b868b87467a8d6480521d4ff82c4d"
) as `0x${string}`;

const PORT = parseInt(process.env.PORT ?? "3000", 10);

// ─── Clients ──────────────────────────────────────────────────────────────────

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ─── Payment middleware ────────────────────────────────────────────────────────

const paymentMiddleware = injectivePaymentMiddleware(
  {
    "POST /ask": {
      description: "AI-powered Injective DeFi intelligence — $0.01 WUSDT per query",
      mimeType: "application/json",
      accepts: [
        {
          network: "eip155:1776",
          asset: WUSDT_ADDRESS,
          maxAmountRequired: "10000", // 0.01 USDT (6 decimals)
          maxTimeoutSeconds: 120,
        },
      ],
    },
  },
  {
    facilitator: {
      privateKey: process.env.PRIVATE_KEY as `0x${string}`,
    },
  }
);

// ─── App ──────────────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.get("/config", (_req, res) => {
  res.json({
    wusdtAddress: WUSDT_ADDRESS,
    wusdtName: "x402 Wrapped USDT",
    chainId: 1776,
    pricePerQuery: "0.01",
  });
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
app.post("/ask", paymentMiddleware as any, async (req, res) => {
  try {
    const { question } = req.body as { question?: string };
    if (!question?.trim()) {
      res.status(400).json({ error: "question is required" });
      return;
    }

    let context: Record<string, unknown> = {};
    try {
      context = await gatherContext(question);
    } catch (e) {
      console.warn("Injective data fetch failed:", e);
      context = { note: "Live data temporarily unavailable" };
    }

    const message = await anthropic.messages.create({
      model: "claude-opus-4-5",
      max_tokens: 512,
      system: `\
You are an expert on Injective Protocol DeFi markets.
Answer the user's question concisely using the live on-chain data provided below.

Price scaling on Injective:
- Perpetual market prices (midPrice, bestBid, bestAsk) are in quote token units
  with 6 extra decimal places. Divide by 1,000,000 for the USD value.
  Example: midPrice "42150250000" → $42,150.25

Format numbers clearly (e.g. "$42,150.25", "3.7% annualised funding").
Be specific and data-driven. Keep answers under 180 words.
If data is missing for a specific metric, say so rather than guessing.`,
      messages: [
        {
          role: "user",
          content: `Live Injective data (fetched just now):\n${JSON.stringify(context, null, 2)}\n\nQuestion: ${question}`,
        },
      ],
    });

    const x402 = (req as express.Request & { x402?: Record<string, unknown> }).x402;
    const answer = message.content[0];
    if (answer.type !== "text") {
      res.status(500).json({ error: "unexpected Claude response type" });
      return;
    }

    res.json({
      answer: answer.text,
      payer: x402?.payer,
      txHash: x402?.txHash,
      amountPaid: "0.01 WUSDT",
    });
  } catch (err) {
    console.error("POST /ask error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

// ─── Listen ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  easyx402 → http://localhost:${PORT}`);
  console.log(`  WUSDT:  ${WUSDT_ADDRESS}`);
  console.log(`  Chain:  Injective EVM (1776)`);
  console.log(`  Cost:   $0.01 WUSDT per query\n`);
});
