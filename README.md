# easyx402

Pay-per-query AI chat for Injective DeFi markets, powered by x402 payments on
Injective EVM.

The app charges `0.01 WUSDT` per question. Users connect MetaMask, sign an
EIP-3009 payment authorization, and receive an answer backed by live Injective
market data. The server settles the payment through the canonical
`@x402/injective` implementation from
[InjectiveLabs/x402](https://github.com/InjectiveLabs/x402).

## What is included

- Express server with an x402-gated `POST /ask` endpoint
- Claude-powered answers via Anthropic's API
- Live Injective perpetual market context from aggregator and LCD APIs
- Browser chat UI with MetaMask payment signing
- USDT to WUSDT wrapping and unwrapping flow

## Prerequisites

- Node.js 22+
- npm
- MetaMask
- An Anthropic API key
- A facilitator wallet with enough INJ for settlement gas

## Setup

Clone with submodules so the app gets the canonical x402 implementation:

```bash
git clone --recurse-submodules https://github.com/ckhbtc/easyx402.git
cd easyx402
npm install
```

If you already cloned without submodules:

```bash
git submodule update --init --recursive
```

Create a local `.env` file:

```bash
cp .env.example .env
```

Set:

```bash
PRIVATE_KEY=0x...
ANTHROPIC_API_KEY=sk-ant-...
```

`PRIVATE_KEY` is the facilitator wallet key. It pays INJ gas to settle valid
x402 payments. Never commit `.env`.

## Run

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Build

```bash
npm run build
npm start
```

The `dev` and `build` scripts first build the upstream
`vendor/x402/packages/x402-injective` package so the local app uses the current
canonical implementation.

## Environment

| Name | Required | Description |
| --- | --- | --- |
| `PRIVATE_KEY` | Yes | Facilitator wallet private key for payment settlement |
| `ANTHROPIC_API_KEY` | Yes | Anthropic API key used to answer paid questions |
| `WRAPPED_USDT_ADDRESS` | No | WUSDT contract address; defaults to canonical Injective mainnet WUSDT |
| `PORT` | No | Server port; defaults to `3000` |

## Security Notes

- Keep facilitator wallets funded only with the INJ needed for gas.
- Keep Anthropic API keys and private keys in `.env` or deployment secrets.
- The frontend exposes only public config from `/config`.
- x402 protocol code is sourced from
  [InjectiveLabs/x402](https://github.com/InjectiveLabs/x402).

## License

MIT. See [LICENSE](./LICENSE).
