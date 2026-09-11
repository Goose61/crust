# Crypgo / The Crust — Marketplace Data Points

Reference sheet for comparing The Crust against other NFT marketplaces (Magic Eden Launchpad, Tensor, OpenSea, Metaplex Studio, etc.). Values reflect the codebase as of September 2026.

**Source of truth in code:** `src/lib/platform-fees.ts`, `src/lib/fee-distribution.ts`, `src/components/LaunchWizard.tsx`, `src/lib/gift-fees.ts`.

---

## Platform basics

| Data point | The Crust (Crypgo) |
|---|---|
| **Chain** | Solana only (Metaplex **Core** collections) |
| **Product model** | Launch + primary mint + in-ecosystem secondary — collections **do not graduate** to another site |
| **Launch fee** | **$0** — no Crypgo launch/platform listing fee |
| **Who pays Arweave** | **Creator** at Go Live (one-time, from connected wallet) |
| **Payment processing** | **Absorbed by platform** — SlicePay/card checkout surcharge is **not** passed to buyers or creators |

---

## Fixed marketplace fees (not creator-configurable)

Defined in `src/lib/platform-fees.ts`:

| Fee type | Rate | Notes |
|---|---|---|
| **Primary platform fee** | **0.7%** | On mint price |
| **Primary trade tax** | **0.3%** | On mint price |
| **Primary total** | **1.0%** | Deducted **before** creator revenue split |
| **Secondary platform fee** | **0.5%** | On resale price |
| **SlicePay / card fees** | **0% passed through** | Platform absorbs processor cost |

### Primary mint math (per $100 mint)

- Crypgo takes: **$1.00**
- Remaining for creator split: **$99.00**

### Secondary sale math (per $100 sale, fee-ledger model)

- Crypgo takes: **$0.50**
- Creator royalties (see below) are calculated separately from the sale price

---

## Creator-configurable revenue (locks at launch)

### Primary mint split (`fees` — must sum to 100%)

| Bucket | Default | Configurable |
|---|---|---|
| **Creator / owner** | **98%** | 0–100% |
| **Holders treasury** | **1%** | 0–100% |
| **Buyback treasury** | **1%** | 0–100% |

- **Locks permanently at Go Live**
- Applied to **net after the 1% Crypgo primary fee**
- Holder treasury is distributed via the **fee_distribution** milestone (pro-rata by NFTs held at snapshot)
- Buyback treasury can auto-buy the **cheapest secondary listing** when the **treasury_buyback** milestone fires

Default split constant: `DEFAULT_CREATOR_FEE_SPLIT` in `src/lib/platform-fees.ts` (98 / 1 / 1).

### Secondary royalty (Metaplex + off-chain routing)

| Setting | Default | Range |
|---|---|---|
| **Royalty (sellerFeeBps)** | **500 bps = 5%** | **0–25%** in launch UI (on-chain max 10,000 bps) |
| **Royalty destination split** | **100% owner** (draft default) | Owner / holders / buyback treasuries |

- Up to **5 Metaplex royalty creators** (shares must sum to 100%)
- Optional **royalty split** routes royalties to holder/buyback treasuries (same buckets as primary)

---

## Launch / upfront costs (creator)

### Collection launch

| Cost item | How it works |
|---|---|
| **Crypgo launch fee** | **$0** |
| **Arweave permanent storage** | **Pass-through** — creator pays **actual Irys/Arweave price in SOL** at Go Live |
| **UI rough estimate** | `~$0.006/MB`; formula: `(tokens × 201 KB) / 1024 × $0.006`, minimum **$0.05** |
| **Actual byte estimate** | Sum of image bytes + `~900 bytes × 2 × token count` (image + metadata uploads) via `estimateArweaveBytes()` |
| **Large collections** | One **SOL payment to platform wallet** + **server bulk upload** (batches of 8) — avoids per-file wallet signatures |
| **Storage payment buffer** | **+2%** SOL when paying platform for bulk upload |
| **Solana tx fees at launch** | UI shows **~$0.01** (negligible) |
| **Collection creation on-chain** | Metaplex Core collection tx (platform co-signs; rent/fees from infra wallet) |

**Rule of thumb:** For a **600-piece** drop, expect roughly **~$0.70–$2+ in storage** depending on image size (wizard heuristic), **plus** small SOL network fees — **not** a percentage of mint revenue.

### Gift mint (`/gift`) — separate from collection launch

| Cost item | Amount |
|---|---|
| **Arweave storage** | Dynamic Irys quote (image + ~512 B metadata) + **10% buffer** |
| **Mint account rent** | **~0.0065 SOL** (6,500,000 lamports) |
| **Tx fee buffer** | **~0.00001 SOL** (10,000 lamports) |
| **Extra safety buffer** | **~0.0005 SOL** (500,000 lamports) |
| **Total mint-step minimum** | **~0.007 SOL** after storage |
| **Who pays** | **Minter/gifter** (not creator) |
| **Crypgo fee on gift** | No separate gift platform fee in code |

---

## Mint pricing (creator-set)

| Setting | Default | Notes |
|---|---|---|
| **Base mint price** | **$25 USD** | Quoted in USD; SOL at spot |
| **Trait surcharges** | **+$0 to +$X per trait** | Per-trait `priceModifier` in USD |
| **Milestone price increase** | **+10% of current base** | When `mint_price_increase` milestone fires |
| **Bundle discount** | Milestone flag only | `enable_bundle_mint` toggles feature — **no fixed discount % in code yet** |
| **Meme coin / SPL discount** | **0%** | Wizard: same USD value, no discount (`pizzaDiscountPercent` forced to 0) |

---

## Payment methods (buyers)

| Method | Primary mint | Secondary |
|---|---|---|
| **SlicePay** (card / USDC via checkout) | Yes | Yes — **required** in production |
| **SOL** (spot-priced transfer to creator wallet) | Yes | No |
| **USDC** (direct) | Toggle in wizard | Via SlicePay only in practice |
| **Custom SPL / meme coin** | Toggle in wizard | **Not wired in checkout UI** |
| **Demo checkout** | Dev only (no SlicePay merchant) | Dev only |

---

## Limits & infrastructure caps

| Limit | Value |
|---|---|
| **Max supply (layer-generated)** | **10,000** |
| **Max ZIP upload** | **500 MB** |
| **Vercel Blob staging (Hobby)** | **1 GB** (temporary during import) |
| **Arweave upload batch size** | **8 tokens per API request** |
| **Metaplex royalty creators** | **5 max** |
| **Mint rate limit** | **10 mints / 15 min / wallet** (API) |

---

## Post-launch / marketplace features

| Feature | Status |
|---|---|
| **Native secondary listings** | Yes (milestone-gated: `enable_secondary`) |
| **Blind mint + reveal** | Yes — manual, % sold, sell-out, datetime, staggered (~10% batches) |
| **Allowlist / public mint** | Yes |
| **Gift mint to another wallet** | Yes (milestone or launch toggle) |
| **Holder lounge / snapshots** | Yes — milestone-driven |
| **Trait browser / rarity chart** | Yes — milestone-driven |
| **Treasury floor buyback** | Yes — uses buyback treasury USD balance |
| **Holder fee claims** | Yes — pro-rata by NFT count at distribution snapshot |
| **Referral bonus boost** | Partial — milestone sets **14-day** boost window; **no % defined in code** |
| **Bundle mint discount** | Partial — flag only; **no discount % implemented** |
| **Discord role sync / SPL airdrop** | Partial — milestone flags (pending/backend hooks) |

---

## Example economics

**Assumptions:** 600 supply, **$25** mint, default **98/1/1** primary split, **5%** secondary royalty, full sell-out.

| Line item | Amount |
|---|---|
| **Gross primary revenue** | **$15,000** |
| **Crypgo primary fees (1%)** | **$150** |
| **Net to creator split** | **$14,850** |
| → Creator wallet (98%) | **$14,553** |
| → Holders treasury (1%) | **$148.50** |
| → Buyback treasury (1%) | **$148.50** |
| **Upfront launch storage (est.)** | **~$0.70–$2+** (size-dependent) |
| **Crypgo launch fee** | **$0** |

**Secondary example — $100 resale, 5% royalty, 100% to creator royalty split:**

- Crypgo: **$0.50**
- Royalties: **$5.00**
- Seller net (ledger model): **~$94.50**

---

## Comparison talking points

### Strengths

- **Very low take rate** on primary (**1%** total vs many launchpads at **2.5–10%+**)
- **No launch fee**
- **No checkout surcharge** on card payments
- **Programmable fee splits** (holders + buyback treasuries built-in)
- **Permanent Arweave** storage model (creator pays once, not recurring platform hosting)
- **Collections stay on-platform** after sell-out

### Caveats (for fair comparison)

- **Solana / Metaplex Core only** (not EVM multi-chain)
- **Secondary checkout is SlicePay-centric** in production (not full crypto-native secondary yet)
- Some wizard/marketing features (**bundle discount, referral %, SPL mint, USDC direct**) are **partially implemented or flag-only**
- Fee/royalty routing is largely **in-app ledger + Metaplex metadata** — compare carefully to marketplaces with enforced on-chain royalties

---

## Spreadsheet columns (competitor comparison)

Use these columns when building a side-by-side comparison:

1. Launch fee
2. Primary marketplace fee
3. Secondary marketplace fee
4. Payment processing pass-through
5. Storage cost model & who pays
6. Creator royalty cap / default
7. Holder revenue share
8. Buyback / treasury tools
9. Chains supported
10. NFT standard
11. Card checkout
12. In-ecosystem secondary
13. Allowlist / phases
14. Blind mint / reveal

---

## Related code paths

| Topic | File(s) |
|---|---|
| Fixed platform fees | `src/lib/platform-fees.ts` |
| Fee accrual & splits | `src/lib/fee-distribution.ts` |
| Launch wizard UI & estimates | `src/components/LaunchWizard.tsx` |
| Gift mint costs | `src/lib/gift-fees.ts` |
| Arweave storage payment | `src/lib/arweave-storage-payment.ts`, `src/lib/irys-client.ts` |
| Mint pricing | `src/lib/collection-ui.ts` (`nftPrice`) |
| Milestones | `src/lib/milestones.ts`, `src/lib/types.ts` |
| Public FAQ copy | `src/components/Home/Faq/index.tsx` |
