# The Crust · Dough Boi Launch

Crypgo Next.js template, restyled for **$PIZZA** and [thecrust.io](https://thecrust.io/). Solana NFT launchpad lives in the same kitchen.

Phase 1 app: Path B layer compositor, Path A image import, Irys-ready storage, milestones, blind mint, SlicePay + $PIZZA quotes, gift mint.

## Run

Node 22 is expected. From this folder:

```bash
npm install
npm run dev
```

Open http://localhost:3000

## First launch (Pizza 600)

1. Go to `/launch`
2. Click **Import Pizza 600 from this workspace**
3. Walk through payments, fees, blind mint, milestones
4. Go live
5. Mint on `/collection/[id]` (connect Phantom)

## Env

Copy `.env.example` to `.env.local`:

- `IRYS_SOLANA_KEY` — Solana private key for Irys uploads (optional; otherwise local staging URLs)
- `SLICEPAY_MERCHANT_ID` / `SLICEPAY_API_KEY` — live USDC checkout (optional; demo invoice otherwise)

Storage default: **Irys → Arweave**. Without a key, assets are served from `/api/assets`.

## Layout

- `/launch` — wizard
- `/discover` — live collections
- `/collection/[id]` — mint page
- `/dashboard` — reveal + stats
- `/market` — secondary (unlocks via milestone)
