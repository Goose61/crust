import { NextRequest, NextResponse } from "next/server";
import {
  clearTokenReservation,
  committedCount,
  getCollection,
  tryAssignTokenOwner,
  tryClearTokenOwner,
  tryReserveToken,
  updateCollection,
} from "@/lib/store";
import { fireDueMilestones } from "@/lib/milestones";
import { applyRevealTriggers } from "@/lib/reveal";
import { rateLimit } from "@/lib/rate-limit";
import { readAuthHeaders, assertCreatorAuth, requireWalletAuth } from "@/lib/wallet-auth";
import { consumePaidInvoice, verifySlicePayInvoice } from "@/lib/slicepay";
import { consumeSolSignature, verifySolPayment } from "@/lib/verify-payment";
import { getQuote } from "@/lib/quotes";
import { isValidSolanaAddress } from "@/lib/mint-nft";
import { parseNetwork } from "@/lib/solana-config";
import { nftPrice } from "@/lib/collection-ui";
import { buildPendingMintForToken } from "@/lib/collection-mint-on-chain";
import { getPlatformSecretKey } from "@/lib/platform-key";
import { accrueSaleFees, claimHolderFees, previewHolderClaim } from "@/lib/fee-distribution";
import { toPublicCollection, tokenIsCommitted } from "@/lib/public-collection";
import type { BuildTxResult } from "@/lib/mint-nft";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Params) {
  const { id } = await params;
  const collection = await getCollection(id);
  if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });

  const triggered = applyRevealTriggers(collection);
  const revealChanged =
    triggered.revealed !== collection.revealed ||
    JSON.stringify(triggered.revealedTokenIds ?? []) !==
      JSON.stringify(collection.revealedTokenIds ?? []);

  if (revealChanged) {
    await updateCollection(id, () => triggered);
    return NextResponse.json({ collection: toPublicCollection(triggered) });
  }
  return NextResponse.json({ collection: toPublicCollection(collection) });
}

async function rollbackMint(params: {
  id: string;
  tokenIds: number[];
  recipient: string;
  onChain: boolean;
}) {
  for (const tokenId of params.tokenIds) {
    if (params.onChain) {
      await clearTokenReservation(params.id, tokenId);
    } else {
      await tryClearTokenOwner(params.id, tokenId, params.recipient);
    }
  }
}

export async function POST(req: NextRequest, { params }: Params) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0] ?? "unknown";
  const { id } = await params;
  const body = await req.json();

  try {
    if (body.action === "waitlist") {
      const rl = await rateLimit(`waitlist:${ip}`, 10, 60 * 60 * 1000);
      if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

      const collection = await updateCollection(id, (current) => {
        const wallet = String(body.wallet || "").trim();
        if (wallet && !isValidSolanaAddress(wallet)) {
          throw new Error("Invalid wallet address");
        }
        if (wallet && !current.waitlist.includes(wallet)) {
          current.waitlist.push(wallet);
        }
        return current;
      });
      if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ collection: toPublicCollection(collection) });
    }

    if (body.action === "allowlist") {
      const auth = readAuthHeaders(req);
      const existing = await getCollection(id);
      if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
      try {
        assertCreatorAuth(auth, existing.payments.creatorWallet);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unauthorized";
        return NextResponse.json({ error: message }, { status: 401 });
      }

      const collection = await updateCollection(id, (current) => {
        const wallets = String(body.wallets || "")
          .split(/[\s,]+/)
          .map((w: string) => w.trim())
          .filter(Boolean);
        for (const w of wallets) {
          if (!isValidSolanaAddress(w)) throw new Error(`Invalid wallet: ${w}`);
        }
        current.allowlist = Array.from(new Set([...current.allowlist, ...wallets]));
        current.publicMintOpen = current.allowlist.length === 0;
        return current;
      });
      if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ collection: toPublicCollection(collection) });
    }

    if (body.action === "mint") {
      const payer = String(body.payer || ip);
      const rl = await rateLimit(`mint:${payer}`, 10, 15 * 60 * 1000);
      if (!rl.allowed) return NextResponse.json({ error: "Too many requests" }, { status: 429 });

      const payerAddr = String(body.payer || "");
      if (!payerAddr || !isValidSolanaAddress(payerAddr)) {
        return NextResponse.json({ error: "Valid payer wallet required" }, { status: 400 });
      }

      const pre = await getCollection(id);
      if (!pre) return NextResponse.json({ error: "not found" }, { status: 404 });

      const requestedId = body.tokenId != null ? Number(body.tokenId) : null;
      const tokenForPrice =
        requestedId != null
          ? pre.tokens.find((t) => t.tokenId === requestedId)
          : pre.tokens.find((t) => !tokenIsCommitted(t));
      const expectedUsd = tokenForPrice ? nftPrice(pre, tokenForPrice) : pre.payments.basePriceUsd;
      const method = String(body.method || "slicepay");
      const invoiceId = String(body.invoiceId || "");
      const txSignature = String(body.txSignature || "");

      if (method === "slicepay") {
        const orderPrefix = `mint-${pre.id}-`;
        const verified = await verifySlicePayInvoice(invoiceId, expectedUsd, orderPrefix);
        if (!verified.ok) {
          return NextResponse.json({ error: verified.error ?? "Payment not verified" }, { status: 402 });
        }
      } else if (method === "sol") {
        const quote = await getQuote(expectedUsd);
        const recipient = pre.payments.creatorWallet;
        if (!recipient) {
          return NextResponse.json({ error: "Creator payout wallet not set" }, { status: 400 });
        }
        const network = parseNetwork(body.network);
        const verified = await verifySolPayment(txSignature, recipient, quote.sol, network);
        if (!verified.ok) {
          return NextResponse.json({ error: verified.error ?? "SOL payment not verified" }, { status: 402 });
        }
      } else if (method === "demo") {
        if (process.env.SLICEPAY_MERCHANT_ID) {
          return NextResponse.json({ error: "Demo mint disabled in production" }, { status: 400 });
        }
      } else {
        return NextResponse.json({ error: "Unsupported payment method" }, { status: 400 });
      }

      if (pre.status !== "live") {
        return NextResponse.json({ error: "Collection is not live" }, { status: 400 });
      }
      if (committedCount(pre) >= pre.supply) {
        return NextResponse.json({ error: "Sold out" }, { status: 400 });
      }
      if (
        !pre.publicMintOpen &&
        pre.allowlist.length > 0 &&
        !pre.allowlist.includes(payerAddr)
      ) {
        return NextResponse.json({ error: "Not on allowlist" }, { status: 403 });
      }

      const qty = Math.max(1, Math.min(10, Number(body.qty ?? 1)));
      const remaining = pre.supply - committedCount(pre);
      const minted = Math.min(qty, remaining);
      const recipient = String(body.recipient || body.payer || "");
      if (recipient && !isValidSolanaAddress(recipient)) {
        return NextResponse.json({ error: "Invalid recipient wallet" }, { status: 400 });
      }
      const recipientAddr = recipient || payerAddr;
      const available = pre.tokens.filter((t) => !tokenIsCommitted(t));
      const pick =
        requestedId != null
          ? available.filter((t) => t.tokenId === requestedId).slice(0, 1)
          : available.slice(0, minted);
      if (pick.length === 0) {
        return NextResponse.json(
          { error: requestedId != null ? "That NFT is already sold" : "Sold out" },
          { status: 400 },
        );
      }

      const useOnChain = pick.length === 1 && Boolean(getPlatformSecretKey());
      const mintedTokenIds: number[] = [];

      for (const token of pick) {
        if (useOnChain) {
          const reserved = await tryReserveToken(id, token.tokenId, recipientAddr);
          if (!reserved) {
            await rollbackMint({ id, tokenIds: mintedTokenIds, recipient: recipientAddr, onChain: true });
            return NextResponse.json({ error: "That NFT is already sold" }, { status: 400 });
          }
        } else {
          const assigned = await tryAssignTokenOwner(id, token.tokenId, recipientAddr);
          if (!assigned) {
            await rollbackMint({ id, tokenIds: mintedTokenIds, recipient: recipientAddr, onChain: false });
            return NextResponse.json({ error: "That NFT is already sold" }, { status: 400 });
          }
        }
        mintedTokenIds.push(token.tokenId);
      }

      let txResult: BuildTxResult | null = null;
      if (useOnChain) {
        const tokenId = mintedTokenIds[0];
        const network = parseNetwork(body.network);
        try {
          const built = await buildPendingMintForToken({
            collection: pre,
            tokenId,
            payer: payerAddr,
            recipient: recipientAddr,
            network,
          });
          txResult = built.txResult;
        } catch (e) {
          await rollbackMint({ id, tokenIds: mintedTokenIds, recipient: recipientAddr, onChain: true });
          const message = e instanceof Error ? e.message : "On-chain mint could not be built";
          console.error("[mint] On-chain tx build failed:", e);
          return NextResponse.json({ error: message }, { status: 500 });
        }
      }

      if (method === "slicepay") {
        const consumed = await consumePaidInvoice(invoiceId);
        if (!consumed.ok) {
          await rollbackMint({
            id,
            tokenIds: mintedTokenIds,
            recipient: recipientAddr,
            onChain: useOnChain,
          });
          return NextResponse.json({ error: consumed.error ?? "Invoice already used" }, { status: 402 });
        }
      } else if (method === "sol") {
        const consumed = await consumeSolSignature(txSignature);
        if (!consumed.ok) {
          await rollbackMint({
            id,
            tokenIds: mintedTokenIds,
            recipient: recipientAddr,
            onChain: useOnChain,
          });
          return NextResponse.json({ error: consumed.error ?? "SOL payment already used" }, { status: 402 });
        }
      }

      const feeBreakdowns: ReturnType<typeof accrueSaleFees>["breakdown"][] = [];
      const collection = await updateCollection(id, (current) => {
        for (const tokenId of mintedTokenIds) {
          const token = current.tokens.find((t) => t.tokenId === tokenId);
          if (!token) continue;
          const saleUsd = nftPrice(current, token);
          const accrued = accrueSaleFees(current, {
            saleUsd,
            kind: "primary_mint",
            tokenId: token.tokenId,
            payer: payerAddr,
          });
          feeBreakdowns.push(accrued.breakdown);
          if (txResult && tokenId === mintedTokenIds[0]) {
            token.assetAddress = txResult.assetAddress;
          }
        }
        if (txResult) {
          current.pendingMint = { ...txResult.pendingMint, tokenId: mintedTokenIds[0] };
        }
        current.mintedCount = committedCount(current);
        if (current.mintedCount >= current.supply) current.status = "sold_out";
        let updated = fireDueMilestones(current);
        updated = applyRevealTriggers(updated);
        return updated;
      });
      if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });

      return NextResponse.json({
        collection: toPublicCollection(collection),
        mintedTokenIds,
        recipient: recipientAddr,
        requiresOnChainMint: Boolean(txResult),
        feeBreakdowns,
      });
    }

    if (body.action === "list_secondary") {
      let auth;
      try {
        auth = requireWalletAuth(req);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unauthorized";
        return NextResponse.json({ error: message }, { status: 401 });
      }
      const wallet = auth.wallet;
      const tokenId = Number(body.tokenId);
      const priceUsd = Number(body.priceUsd);
      if (!tokenId || priceUsd <= 0) {
        return NextResponse.json({ error: "tokenId and priceUsd required" }, { status: 400 });
      }
      const collection = await updateCollection(id, (current) => {
        if (!current.secondaryEnabled) throw new Error("Secondary market not enabled");
        const token = current.tokens.find((t) => t.tokenId === tokenId);
        if (!token?.owner) throw new Error("Token not owned");
        if (token.owner !== wallet) throw new Error("Only the owner can list");
        token.listing = { priceUsd, listedAt: new Date().toISOString() };
        return current;
      });
      if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ collection: toPublicCollection(collection) });
    }

    if (body.action === "unlist_secondary") {
      let auth;
      try {
        auth = requireWalletAuth(req);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unauthorized";
        return NextResponse.json({ error: message }, { status: 401 });
      }
      const wallet = auth.wallet;
      const tokenId = Number(body.tokenId);
      const collection = await updateCollection(id, (current) => {
        const token = current.tokens.find((t) => t.tokenId === tokenId);
        if (!token?.listing) throw new Error("Not listed");
        if (token.owner !== wallet) throw new Error("Only the owner can unlist");
        token.listing = null;
        return current;
      });
      if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ collection: toPublicCollection(collection) });
    }

    if (body.action === "buy_secondary") {
      const payerAddr = String(body.payer || "");
      if (!payerAddr || !isValidSolanaAddress(payerAddr)) {
        return NextResponse.json({ error: "Valid payer wallet required" }, { status: 400 });
      }
      const tokenId = Number(body.tokenId);
      const pre = await getCollection(id);
      if (!pre) return NextResponse.json({ error: "not found" }, { status: 404 });
      const token = pre.tokens.find((t) => t.tokenId === tokenId);
      if (!token?.listing) return NextResponse.json({ error: "Not listed for sale" }, { status: 400 });
      const expectedUsd = token.listing.priceUsd;
      const method = String(body.method || "slicepay");
      const invoiceId = String(body.invoiceId || "");

      if (method === "slicepay") {
        const verified = await verifySlicePayInvoice(
          invoiceId,
          expectedUsd,
          `secondary-${pre.id}-`,
        );
        if (!verified.ok) {
          return NextResponse.json({ error: verified.error ?? "Payment not verified" }, { status: 402 });
        }
      } else if (method === "demo") {
        if (process.env.SLICEPAY_MERCHANT_ID) {
          return NextResponse.json({ error: "Demo buy disabled in production" }, { status: 400 });
        }
      } else {
        return NextResponse.json({ error: "Secondary buys require SlicePay" }, { status: 400 });
      }

      if (method === "slicepay") {
        const consumed = await consumePaidInvoice(invoiceId);
        if (!consumed.ok) {
          return NextResponse.json({ error: consumed.error ?? "Invoice already used" }, { status: 402 });
        }
      }

      let secondaryBreakdown: ReturnType<typeof accrueSaleFees>["breakdown"] | null = null;
      const sellerWallet = token.owner ?? undefined;

      const collection = await updateCollection(id, (current) => {
        if (!current.secondaryEnabled) throw new Error("Secondary market not enabled");
        const t = current.tokens.find((x) => x.tokenId === tokenId);
        if (!t?.listing) throw new Error("Not listed for sale");
        if (t.owner === payerAddr) throw new Error("Already yours");
        const saleUsd = t.listing.priceUsd;
        t.owner = payerAddr;
        t.listing = null;
        const accrued = accrueSaleFees(current, {
          saleUsd,
          kind: "secondary_sale",
          tokenId,
          payer: payerAddr,
          seller: sellerWallet,
        });
        secondaryBreakdown = accrued.breakdown;
        return current;
      });
      if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({
        collection: toPublicCollection(collection),
        tokenId,
        buyer: payerAddr,
        feeBreakdown: secondaryBreakdown,
      });
    }

    if (body.action === "claim_fees") {
      let auth;
      try {
        auth = requireWalletAuth(req);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unauthorized";
        return NextResponse.json({ error: message }, { status: 401 });
      }
      const wallet = auth.wallet;
      let claimedUsd = 0;
      const collection = await updateCollection(id, (current) => {
        const result = claimHolderFees(current, wallet);
        claimedUsd = result.claimedUsd;
        return result.collection;
      });
      if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({
        collection: toPublicCollection(collection),
        claimedUsd,
        wallet,
      });
    }

    if (body.action === "fee_status") {
      const wallet = String(body.wallet || "");
      const collection = await getCollection(id);
      if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });
      const preview =
        wallet && isValidSolanaAddress(wallet)
          ? previewHolderClaim(collection, wallet)
          : null;
      return NextResponse.json({
        feeLedger: collection.feeLedger ?? null,
        feeClaimsOpen: collection.feeClaimsOpen ?? false,
        treasuryBuybackActive: collection.treasuryBuybackActive ?? false,
        buybackTokenCa: collection.buybackTokenCa ?? null,
        claimPreview: preview,
      });
    }

    if (body.action === "reveal") {
      const auth = readAuthHeaders(req);
      const existing = await getCollection(id);
      if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
      try {
        assertCreatorAuth(auth, existing.payments.creatorWallet);
      } catch (e) {
        const message = e instanceof Error ? e.message : "Unauthorized";
        return NextResponse.json({ error: message }, { status: 401 });
      }

      const collection = await updateCollection(id, (current) => {
        current.revealed = true;
        return current;
      });
      if (!collection) return NextResponse.json({ error: "not found" }, { status: 404 });
      return NextResponse.json({ collection: toPublicCollection(collection) });
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Request failed";
    const status =
      message === "Not on allowlist" ? 403 : message === "not found" ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
