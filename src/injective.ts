/**
 * Injective data router.
 *
 * Uses two data sources:
 *   1. Aggregator API — prices, OI, funding rates, volume (human-readable)
 *   2. LCD API — market IDs, orderbooks, perpetual info
 *
 * Base URLs:
 *   Aggregator: https://k8s.global.mainnet.aggregator.grpc-web.injective.network
 *   LCD:        https://sentry.lcd.injective.network
 */

const AGGREGATOR = "https://k8s.global.mainnet.aggregator.grpc-web.injective.network";
const AGGREGATOR_FALLBACK = "https://sentry.exchange.grpc-web.injective.network";
const LCD = "https://sentry.lcd.injective.network";

// ─── Types ────────────────────────────────────────────────────────────────────

interface ContractSummary {
  ticker: string;
  lastPrice: number;
  bid: number;
  ask: number;
  high: number;
  low: number;
  volume24h: number;
  openInterestUsd: number;
  indexPrice: number;
  fundingRate: number;
  nextFundingRate: number;
  nextFundingRateTimestamp: number;
}

// ─── Keyword → ticker mapping ──────────────────────────────────────────────────

const TICKER_KEYWORDS: Record<string, string[]> = {
  BTC:   ["btc", "bitcoin"],
  ETH:   ["eth", "ethereum", "ether"],
  INJ:   ["inj", "injective"],
  SOL:   ["sol", "solana"],
  ATOM:  ["atom", "cosmos"],
  TIA:   ["tia", "celestia"],
  ARB:   ["arb", "arbitrum"],
  OP:    ["op", "optimism"],
  DOGE:  ["doge", "dogecoin"],
  WIF:   ["wif", "dogwifhat"],
  PEPE:  ["pepe"],
  LINK:  ["link", "chainlink"],
  AVAX:  ["avax", "avalanche"],
  MATIC: ["matic", "polygon"],
  SUI:   ["sui"],
  SEI:   ["sei"],
  APT:   ["apt", "aptos"],
  BNB:   ["bnb", "binance"],
  XAU:   ["xau", "gold"],
  MSFT:  ["msft", "microsoft"],
  AAPL:  ["aapl", "apple"],
  NVDA:  ["nvda", "nvidia"],
};

// ─── HTTP helpers ──────────────────────────────────────────────────────────────

async function jsonGet(url: string, timeoutMs = 8000): Promise<unknown> {
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${url}`);
  return res.json();
}

async function lcdGet(endpoint: string): Promise<unknown> {
  return jsonGet(`${LCD}${endpoint}`);
}

// ─── Aggregator (prices, OI, funding) ─────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toContractSummary(c: any): ContractSummary {
  return {
    ticker:                    c.ticker_id,
    lastPrice:                 c.last_price,
    bid:                       c.bid,
    ask:                       c.ask,
    high:                      c.high,
    low:                       c.low,
    volume24h:                 c.target_volume,
    openInterestUsd:           c.open_interest,
    indexPrice:                c.index_price,
    fundingRate:               c.funding_rate,
    nextFundingRate:           c.next_funding_rate,
    nextFundingRateTimestamp:  c.next_funding_rate_timestamp,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function fetchContracts(): Promise<any[]> {
  try {
    return (await jsonGet(`${AGGREGATOR}/api/aggregator/v1/derivative/contracts`)) as unknown[];
  } catch {
    return (await jsonGet(`${AGGREGATOR_FALLBACK}/api/aggregator/v1/derivative/contracts`)) as unknown[];
  }
}

// ─── Keyword detection ────────────────────────────────────────────────────────

function detectTickers(question: string): string[] {
  const q = question.toLowerCase();
  return Object.entries(TICKER_KEYWORDS)
    .filter(([, kws]) => kws.some((kw) => q.includes(kw)))
    .map(([ticker]) => ticker);
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function gatherContext(
  question: string
): Promise<Record<string, unknown>> {
  const q = question.toLowerCase();
  const ctx: Record<string, unknown> = {};

  // ── 1. Fetch aggregator data (prices, OI, funding) ───────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let contracts: any[] = [];
  try {
    contracts = await fetchContracts();
  } catch (e) {
    ctx.aggregatorError = String(e);
  }

  const perpContracts = contracts.filter(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (c: any) => c.product_type === "Perpetual"
  );
  ctx.totalActivePerpMarkets = perpContracts.length;

  // ── 2. Detect tickers mentioned in the question ──────────────────────────
  const tickers = detectTickers(question);

  // ── 3. Market overview for general questions ─────────────────────────────
  const isGeneral =
    tickers.length === 0 ||
    q.includes("all") ||
    q.includes("list") ||
    q.includes("top") ||
    q.includes("market") ||
    q.includes("overview") ||
    q.includes("compare");

  if (isGeneral) {
    ctx.perpMarkets = perpContracts
      .slice(0, 20)
      .map(toContractSummary);
  }

  // ── 4. Per-ticker deep-dives ─────────────────────────────────────────────
  // Lazy-load LCD markets for market params (oracle, margins, market_id)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let lcdMarkets: any[] | null = null;

  async function getLcdMarkets() {
    if (!lcdMarkets) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const res = (await lcdGet(
          "/injective/exchange/v1beta1/derivative/markets?status=Active"
        )) as { markets: unknown[] };
        lcdMarkets = res.markets as unknown[];
      } catch {
        lcdMarkets = [];
      }
    }
    return lcdMarkets;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function findLcdMarket(markets: any[], ticker: string) {
    return markets.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (m: any) =>
        m.market?.ticker?.startsWith(ticker + "/") ||
        m.market?.ticker?.startsWith(ticker + " ")
    );
  }

  for (const ticker of tickers) {
    // Find in aggregator data (ticker format: "BTC/USDT PERP")
    const contract = perpContracts.find(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (c: any) =>
        c.ticker_id?.startsWith(ticker + "/") ||
        c.base_currency === ticker
    );

    if (contract) {
      ctx[ticker] = toContractSummary(contract);
    } else {
      ctx[`${ticker}_note`] = `No active ${ticker} perpetual market found`;
    }

    // Always fetch LCD market data for oracle info, margin params, etc.
    const markets = await getLcdMarkets();
    const lcdMarket = findLcdMarket(markets, ticker);

    if (lcdMarket?.market) {
      const m = lcdMarket.market;
      ctx[`${ticker}_marketParams`] = {
        marketId:            m.market_id,
        ticker:              m.ticker,
        oracleType:          m.oracle_type,
        oracleBase:          m.oracle_base,
        oracleQuote:         m.oracle_quote,
        oracleScaleFactor:   m.oracle_scale_factor,
        initialMarginRatio:  m.initial_margin_ratio,
        maintenanceMarginRatio: m.maintenance_margin_ratio,
        makerFeeRate:        m.maker_fee_rate,
        takerFeeRate:        m.taker_fee_rate,
        minPriceTickSize:    m.min_price_tick_size,
        minQuantityTickSize: m.min_quantity_tick_size,
        status:              m.status,
      };
    }

    // Orderbook — fetch using market_id
    const wantsOrderbook =
      q.includes("orderbook") ||
      q.includes("order book") ||
      q.includes("book") ||
      q.includes("depth") ||
      q.includes("bid") ||
      q.includes("ask") ||
      q.includes("spread");

    if (wantsOrderbook && lcdMarket?.market?.market_id) {
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const ob = (await lcdGet(
          `/injective/exchange/v1beta1/derivative/orderbook/${lcdMarket.market.market_id}`
        )) as { buys_price_level?: unknown[]; sells_price_level?: unknown[] };
        ctx[`${ticker}_orderbook`] = {
          note: "Prices are raw (divide by 1,000,000 for USD). Quantities are in base units.",
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          bids: (ob.buys_price_level ?? []).slice(0, 5).map((b: any) => ({
            price:    b.p,
            quantity: b.q,
          })),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          asks: (ob.sells_price_level ?? []).slice(0, 5).map((s: any) => ({
            price:    s.p,
            quantity: s.q,
          })),
        };
      } catch (e) {
        ctx[`${ticker}_orderbook_error`] = String(e);
      }
    }
  }

  // ── 5. Fallback: mini overview ───────────────────────────────────────────
  if (Object.keys(ctx).length <= 1) {
    ctx.perpMarkets = perpContracts.slice(0, 10).map(toContractSummary);
  }

  return ctx;
}
