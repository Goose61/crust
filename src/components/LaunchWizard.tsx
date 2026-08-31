"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  MILESTONE_EVENTS,
  type Collection,
  type LayerCatalog,
  type MilestoneEventId,
  type RoyaltySplit,
  type TraitPricing,
  type TraitRarity,
} from "@/lib/types";
import { tokenImageSrc } from "@/lib/collection-ui";
import { buildAuthHeaders } from "@/lib/wallet-auth-client";
import {
  PRIMARY_PLATFORM_FEE_PERCENT,
  PRIMARY_PLATFORM_TOTAL_PERCENT,
  PRIMARY_TRADE_TAX_PERCENT,
  SECONDARY_PLATFORM_FEE_PERCENT,
} from "@/lib/platform-fees";
import { useWallet } from "./WalletProvider";

/* ─── steps ─── */
const STEPS_READY  = ["Collection", "Traits", "Payments", "Fees", "Reveal", "Milestones", "Go live"];
const STEPS_LAYERS = ["Rarity", "Preview", "Collection", "Traits", "Payments", "Fees", "Reveal", "Milestones", "Go live"];

const RARITY_TIERS: TraitRarity[] = ["common", "rare", "epic"];
const RARITY_COLOR: Record<TraitRarity, string> = {
  common: "bg-white/20 text-white",
  rare:   "bg-[#f5c542]/20 text-[#f5c542]",
  epic:   "bg-primary/20 text-primary",
};

/* ─── milestone descriptions ─── */
const MILESTONE_DESC: Partial<Record<MilestoneEventId, string>> = {
  reveal_all:            "Publishes all token metadata so traits appear on marketplaces.",
  reveal_batch:          "Reveals the next batch of tokens in sequence (staggered reveal).",
  reveal_rarity_chart:   "Publishes the full rarity chart with trait counts and scores, visible to all.",
  unlock_trait_browser:  "Enables the on-marketplace trait filter and browser for collectors.",
  enable_secondary:      "Allows holders to list their NFTs for sale on the secondary market.",
  enable_gift_mint:      "Lets holders send a mint directly to another wallet as a gift.",
  enable_bundle_mint:    "Unlocks bundle discounts for minting multiple NFTs at a reduced total price.",
  mint_price_increase:   "Automatically steps up the mint price at this milestone.",
  close_primary_mint:    "Closes the primary mint permanently. No new mints allowed after this point.",
  open_public_mint:      "Removes allowlist restrictions so any wallet can mint.",
  unlock_holder_page:    "Reveals a private holder-only section with exclusive content.",
  snapshot_holders:      "Records a holder snapshot, useful for future airdrops or allowlists.",
  airdrop_spl:           "Airdrops SPL tokens to all current holders proportionally.",
  enable_sequel_allowlist:"Automatically adds current holders to the allowlist of your next collection.",
  discord_role_sync:     "Syncs NFT ownership with Discord so verified holders receive a role.",
  featured_homepage:     "Features this collection prominently on the marketplace homepage.",
  creator_banner:        "Displays a custom creator banner on the collection page.",
  live_mint_feed:        "Shows a live ticker of recent mints on the collection page.",
  referral_bonus_boost:  "Temporarily boosts the referral bonus percentage for this collection.",
  treasury_buyback:      "Triggers the treasury to buy back NFTs from secondary, supporting the floor.",
  fee_distribution:      "Opens fee claims so accumulated fees can be withdrawn by eligible wallets.",
};

type Mode = "ready" | "layers" | null;

function buildUniqueTraits(tokens: Collection["tokens"]) {
  const map = new Map<string, Set<string>>();
  for (const t of tokens) {
    for (const a of t.attributes) {
      if (a.trait_type === "Rarity Rank") continue;
      if (!map.has(a.trait_type)) map.set(a.trait_type, new Set());
      map.get(a.trait_type)!.add(String(a.value));
    }
  }
  return Array.from(map.entries()).map(([traitType, vals]) => ({
    traitType,
    values: Array.from(vals).sort(),
  }));
}

function defaultTraitPricing(tokens: Collection["tokens"]): TraitPricing {
  const pricing: TraitPricing = {};
  for (const { traitType, values } of buildUniqueTraits(tokens)) {
    pricing[traitType] = {};
    for (const v of values) {
      pricing[traitType][v] = { rarity: "common", priceModifier: 0 };
    }
  }
  return pricing;
}

/* ─── simple tooltip ─── */
function Info({ tip }: { tip: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative ml-1 inline-block">
      <button
        type="button"
        onMouseEnter={() => setOpen(true)}
        onMouseLeave={() => setOpen(false)}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex h-4 w-4 items-center justify-center rounded-full border border-white/20 text-[9px] font-bold text-white/50 hover:border-white/40 hover:text-white"
      >
        ?
      </button>
      {open && (
        <span className="absolute bottom-full left-0 z-50 mb-2 w-64 rounded-lg border border-white/15 bg-[#161311] px-3 py-2 text-xs leading-relaxed text-white shadow-xl">
          {tip}
        </span>
      )}
    </span>
  );
}

export function LaunchWizard() {
  const router = useRouter();
  const { publicKey, connect } = useWallet();

  const [mode, setMode] = useState<Mode>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [collection, setCollection] = useState<Collection | null>(null);
  const [previews, setPreviews] = useState<
    { tokenId: number; image: string; attributes: Collection["tokens"][0]["attributes"] }[]
  >([]);

  /* ── royalty state ── */
  const [royaltyBps, setRoyaltyBps] = useState(500);        // total secondary royalty basis points
  const [royaltyOwner, setRoyaltyOwner] = useState(true);
  const [royaltyHolders, setRoyaltyHolders] = useState(false);
  const [royaltyBuyback, setRoyaltyBuyback] = useState(false);
  const [royaltySplit, setRoyaltySplit] = useState<RoyaltySplit>({
    ownerPercent: 100,
    holdersPercent: 0,
    buybackPercent: 0,
  });

  const [logoFile, setLogoFile] = useState<File | null>(null);
  const [logoPreview, setLogoPreview] = useState<string | null>(null);
  const [allowlistText, setAllowlistText] = useState("");
  const [allowlistMsg, setAllowlistMsg] = useState<string | null>(null);

  const STEPS = mode === "layers" ? STEPS_LAYERS : STEPS_READY;

  const feesTotal = collection
    ? collection.fees.ownerPercent + collection.fees.holdersPercent +
      collection.fees.buybackPercent
    : 0;

  const royaltySplitTotal = (royaltyOwner ? royaltySplit.ownerPercent : 0) +
    (royaltyHolders ? royaltySplit.holdersPercent : 0) +
    (royaltyBuyback ? royaltySplit.buybackPercent : 0);

  const buybackEnabled =
    royaltyBuyback || (collection?.fees.buybackPercent ?? 0) > 0;

  /* estimated storage & launch cost */
  const estimatedStorageMB = collection ? (collection.tokens.length * 201) / 1024 : 0;
  const estimatedStorageUsd = Math.max(0.05, estimatedStorageMB * 0.006);
  const estimatedMintRevenue = collection
    ? collection.tokens.length * collection.payments.basePriceUsd
    : 0;

  const checklist = useMemo(() => {
    if (!collection) return [];
    return [
      { ok: collection.tokens.length > 0, label: "Art uploaded" },
      { ok: collection.name.trim().length > 1, label: "Name set" },
      { ok: Boolean(collection.payments.creatorWallet || publicKey), label: "Payout wallet" },
      { ok: feesTotal === 100, label: "Mint fee split sums to 100%" },
      {
        ok: !royaltyOwner && !royaltyHolders && !royaltyBuyback
          ? true
          : royaltySplitTotal === 100,
        label: "Royalty split sums to 100%",
      },
      {
        ok: !buybackEnabled || Boolean(collection.buybackTokenCa?.trim()),
        label: "Buyback token CA (contract address)",
      },
    ];
  }, [collection, publicKey, feesTotal, royaltyOwner, royaltyHolders, royaltyBuyback, royaltySplitTotal, buybackEnabled]);

  const uniqueTraits = useMemo(
    () => (collection ? buildUniqueTraits(collection.tokens) : []),
    [collection],
  );

  /* ── upload finished-images ZIP ── */
  async function uploadReadyCollection(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("name", "My collection");
      const res = await fetch("/api/import/images", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const col: Collection = {
        ...data.collection,
        traitPricing: defaultTraitPricing(data.collection.tokens),
      };
      setCollection(col);
      setMode("ready");
      setStep(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  /* ── upload trait-layer ZIP ── */
  async function uploadLayers(file: File) {
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("name", "My collection");
      const res = await fetch("/api/layers/parse", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setCollection(data.collection);
      setMode("layers");
      setStep(0);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  /* ── save / patch collection ── */
  async function save(patch: Partial<Collection> = {}, action?: string, base?: Collection) {
    const src = base ?? collection;
    if (!src) return src;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (publicKey) {
      try {
        Object.assign(headers, await buildAuthHeaders(publicKey));
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : "Sign in with Phantom to save");
      }
    }
    const res = await fetch("/api/collections", {
      method: "POST",
      headers,
      body: JSON.stringify({ ...src, ...patch, action }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Save failed");
    setCollection(data.collection);
    return data.collection as Collection;
  }

  async function persistDraft() {
    if (!collection || !publicKey) return;
    try {
      await save({
        payments: { ...collection.payments, creatorWallet: publicKey },
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save progress");
      throw e;
    }
  }

  async function uploadLogo(collectionId: string) {
    if (!logoFile) return;
    const form = new FormData();
    form.set("file", logoFile);
    const headers: Record<string, string> = {};
    if (publicKey) Object.assign(headers, await buildAuthHeaders(publicKey));
    const res = await fetch(`/api/collections/${collectionId}/logo`, {
      method: "POST",
      headers,
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Logo upload failed");
    if (data.collection) setCollection(data.collection);
  }

  /* ── generate previews ── */
  async function generatePreviews() {
    if (!collection) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/generate/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: collection.id,
          name: collection.name,
          description: collection.description,
          nameTemplate: collection.nameTemplate,
          supply: collection.supply,
          stackOrder: collection.stackOrder,
          layers: collection.layers,
          creatorWallet: publicKey || collection.payments.creatorWallet,
          royaltyPercent: royaltyBps / 100,
          previewCount: 12,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      const col: Collection = {
        ...data.collection,
        traitPricing: collection.traitPricing ?? defaultTraitPricing(data.collection.tokens),
      };
      setCollection(col);
      setPreviews(data.previews);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Preview failed");
    } finally {
      setBusy(false);
    }
  }

  /* ── go live ── */
  async function goLive() {
    if (!collection) return;
    if (!publicKey) {
      await connect();
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const payout = publicKey || collection.payments.creatorWallet;
      const royaltySplitData: RoyaltySplit = {
        ownerPercent: royaltyOwner ? royaltySplit.ownerPercent : 0,
        holdersPercent: royaltyHolders ? royaltySplit.holdersPercent : 0,
        buybackPercent: royaltyBuyback ? royaltySplit.buybackPercent : 0,
      };
      if (buybackEnabled && !collection.buybackTokenCa?.trim()) {
        throw new Error("Enter the buyback token contract address (CA) before launch.");
      }
      let current = await save({
        payments: { ...collection.payments, creatorWallet: payout },
        royaltyBps,
        royaltySplit: royaltySplitData,
        buybackTokenCa: collection.buybackTokenCa?.trim() || undefined,
      });
      if (!current) return;
      if (logoFile) await uploadLogo(current.id);
      if (mode === "layers" && current.layers.length > 0) {
        current = (await save({}, "generate", current)) ?? current;
      }
      current = (await save({}, "publish", current)) ?? current;
      current = (await save({ fees: { ...current.fees, locked: true } }, "go-live", current)) ?? current;
      router.push(`/collection/${current.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Go live failed");
    } finally {
      setBusy(false);
    }
  }

  function updateLayerWeight(traitType: string, value: string, weight: number) {
    if (!collection) return;
    const layers: LayerCatalog[] = collection.layers.map((l) =>
      l.traitType !== traitType
        ? l
        : { ...l, values: l.values.map((v) => (v.value === value ? { ...v, weight } : v)) },
    );
    setCollection({ ...collection, layers });
  }

  function setTraitRarity(traitType: string, value: string, rarity: TraitRarity) {
    if (!collection) return;
    const existing = collection.traitPricing?.[traitType]?.[value] ?? { rarity: "common", priceModifier: 0 };
    setCollection({
      ...collection,
      traitPricing: {
        ...collection.traitPricing,
        [traitType]: { ...collection.traitPricing?.[traitType], [value]: { ...existing, rarity } },
      },
    });
  }

  function setTraitPriceModifier(traitType: string, value: string, priceModifier: number) {
    if (!collection) return;
    const existing = collection.traitPricing?.[traitType]?.[value] ?? { rarity: "common", priceModifier: 0 };
    setCollection({
      ...collection,
      traitPricing: {
        ...collection.traitPricing,
        [traitType]: { ...collection.traitPricing?.[traitType], [value]: { ...existing, priceModifier } },
      },
    });
  }

  function removeMilestone(idx: number) {
    if (!collection) return;
    const milestones = collection.milestones.filter((_, i) => i !== idx);
    setCollection({ ...collection, milestones });
  }

  function stepIs(name: string) {
    return STEPS[step] === name;
  }

  /* ─────────────────────── LANDING ─────────────────────── */
  if (!mode) {
    return (
      <div className="container mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold text-white">Launch a collection</h1>
        <p className="mt-2 text-sm text-white/60">
          Choose how your art is coming in. Both options write permanent on-chain metadata,
          set your own fee splits, and keep primary mint and secondary trading right here.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
            {error}
          </div>
        )}

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          {/* Finished art */}
          <div className="flex flex-col rounded-2xl border border-white/15 bg-white/5 p-6">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/20">
              <svg className="h-6 w-6 text-primary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M4 16l4-4a3 3 0 014 0l4 4m-4-4v8M4 4h16" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white">I have finished art</h2>
            <p className="mt-2 flex-1 text-sm text-white/70">
              ZIP your images (JPG, PNG, or WebP). Optionally include a{" "}
              <code className="text-white/90">metadata/</code> folder of JSON files. We detect all
              traits, let you set rarity tiers and price modifiers per trait value, then write
              permanent on-chain metadata.
            </p>
            <ul className="mt-4 space-y-1 text-xs text-white/50">
              <li>✓ JPG / PNG / WebP in a single ZIP</li>
              <li>✓ Existing metadata JSON auto-imported</li>
              <li>✓ Rarity tier (Common / Rare / Epic) per trait value</li>
              <li>✓ Optional price modifier per trait value</li>
            </ul>
            <label
              className={`mt-6 flex cursor-pointer items-center justify-center rounded-xl border border-primary/60 bg-primary/10 py-3 text-sm font-medium text-white transition hover:bg-primary/20 ${busy ? "pointer-events-none opacity-50" : ""}`}
            >
              {busy ? "Uploading…" : "Upload images ZIP"}
              <input type="file" accept=".zip" className="hidden" disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadReadyCollection(f); }}
              />
            </label>
          </div>

          {/* Trait layers */}
          <div className="flex flex-col rounded-2xl border border-white/15 bg-white/5 p-6">
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white/10">
              <svg className="h-6 w-6 text-white/60" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8}
                  d="M7 21h10M12 3v18M4.5 8.5l7.5-5.5 7.5 5.5" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-white">I have trait layers</h2>
            <p className="mt-2 flex-1 text-sm text-white/70">
              Separate layer PNGs in folders per trait, e.g.{" "}
              <code className="text-white/90">Background/Blue.png</code>. We composite every
              combination, let you tune generation weights per value, then rank rarity and write
              metadata automatically.
            </p>
            <ul className="mt-4 space-y-1 text-xs text-white/50">
              <li>✓ Folders = traits, file names = values</li>
              <li>✓ Adjustable generation weights per trait</li>
              <li>✓ Unique-DNA collision checking</li>
            </ul>
            <label
              className={`mt-6 flex cursor-pointer items-center justify-center rounded-xl border border-white/20 py-3 text-sm font-medium text-white/80 transition hover:border-white/40 hover:text-white ${busy ? "pointer-events-none opacity-50" : ""}`}
            >
              {busy ? "Uploading…" : "Upload layers ZIP"}
              <input type="file" accept=".zip" className="hidden" disabled={busy}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLayers(f); }}
              />
            </label>
          </div>
        </div>
      </div>
    );
  }

  /* ─────────────────────── WIZARD ─────────────────────── */
  return (
    <div className="container mx-auto max-w-4xl px-4 py-10">
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            setMode(null); setCollection(null); setStep(0);
            setError(null); setPreviews([]); setLogoFile(null); setLogoPreview(null);
          }}
          className="text-sm text-white/40 hover:text-white"
        >
          ← Back
        </button>
        <h1 className="text-2xl font-bold text-white">
          {mode === "ready" ? "Finished art collection" : "Layer-generated collection"}
        </h1>
      </div>

      {/* step breadcrumb */}
      <ol className="mt-6 flex flex-wrap gap-2 text-xs">
        {STEPS.map((label, i) => (
          <li
            key={label}
            className={`cursor-pointer rounded-full px-3 py-1 ${
              i === step ? "bg-primary text-white" :
              i < step   ? "bg-primary/20 text-white" :
                           "bg-white/10 text-white/50"
            }`}
            onClick={() => { if (i < step) setStep(i); }}
          >
            {i + 1}. {label}
          </li>
        ))}
      </ol>

      {error && (
        <div className="mt-4 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
          {error}
        </div>
      )}

      <div className="mt-8 rounded-2xl border border-white/15 bg-white/5 p-6">

        {/* ── Layers: rarity weights ── */}
        {mode === "layers" && stepIs("Rarity") && collection && (
          <div className="space-y-6">
            <h2 className="text-lg font-semibold text-white">Trait generation weights</h2>
            <p className="text-sm text-white/60">
              Higher weight = value appears more often in the generated collection.
            </p>
            {collection.layers.map((layer) => (
              <div key={layer.traitType}>
                <div className="mb-2 text-sm font-medium text-white">{layer.traitType}</div>
                {layer.values.map((v) => (
                  <label key={v.value} className="mb-2 flex items-center gap-3 text-sm">
                    <span className="w-40 truncate text-white/80">{v.value}</span>
                    <input type="range" min={1} max={100} value={v.weight}
                      onChange={(e) => updateLayerWeight(layer.traitType, v.value, Number(e.target.value))}
                      className="flex-1" />
                    <span className="w-10 text-right text-white/60">{v.weight}</span>
                  </label>
                ))}
              </div>
            ))}
          </div>
        )}

        {/* ── Layers: preview ── */}
        {mode === "layers" && stepIs("Preview") && collection && (
          <div>
            <h2 className="text-lg font-semibold text-white">Preview generated art</h2>
            <p className="mt-1 mb-4 text-sm text-white/60">Set supply, then generate a sample batch.</p>
            <div className="mb-4 flex gap-4">
              <Field label="Supply">
                <input type="number" className="input w-32" value={collection.supply}
                  onChange={(e) => setCollection({ ...collection, supply: Number(e.target.value) })} />
              </Field>
            </div>
            <button onClick={() => void generatePreviews()} disabled={busy}
              className="rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-40">
              {busy ? "Generating…" : "Generate 12 previews"}
            </button>
            {previews.length > 0 && (
              <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
                {previews.map((p) => (
                  <figure key={p.tokenId} className="overflow-hidden rounded-xl bg-white/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={p.image} alt={`#${p.tokenId}`} className="aspect-square w-full object-cover" />
                    <figcaption className="p-2 text-xs text-white/60">#{p.tokenId}</figcaption>
                  </figure>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Collection details ── */}
        {stepIs("Collection") && collection && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold text-white">Collection details</h2>

            {/* Logo upload */}
            <div>
              <span className="mb-2 block text-sm text-white/60">Logo image</span>
              <label className="inline-flex cursor-pointer items-center gap-3">
                <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-xl border border-white/15 bg-white/5">
                  {logoPreview ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={logoPreview} alt="Logo" className="h-full w-full object-cover" />
                  ) : collection.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={collection.logoUrl} alt="Logo" className="h-full w-full object-cover" />
                  ) : (
                    <span className="text-xs text-white/30">Pick image</span>
                  )}
                </div>
                <span className="text-sm text-white/70">Click to upload logo</span>
                <input type="file" accept="image/*" className="hidden"
                  onChange={(e) => {
                    const f = e.target.files?.[0] ?? null;
                    setLogoFile(f);
                    setLogoPreview(f ? URL.createObjectURL(f) : null);
                  }} />
              </label>
            </div>

            <Field label="Name">
              <input className="input" value={collection.name}
                onChange={(e) => setCollection({ ...collection, name: e.target.value })} />
            </Field>

            <Field label="Description">
              <textarea className="input min-h-24" value={collection.description}
                onChange={(e) => setCollection({ ...collection, description: e.target.value })} />
            </Field>

            {/* Supply: read-only for ready mode (auto-set from images), editable for layers */}
            {mode === "ready" ? (
              <div>
                <div className="mb-1 flex items-center gap-1 text-sm text-white/60">
                  Supply
                  <Info tip="Supply is automatically set to the number of images in your ZIP. It cannot be changed manually. Every image becomes one unique NFT." />
                </div>
                <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  <span className="text-sm font-medium text-white">{collection.supply} NFTs</span>
                  <span className="text-xs text-white/40">auto-detected from uploaded images</span>
                </div>
              </div>
            ) : (
              <Field label="Supply">
                <input type="number" className="input" value={collection.supply}
                  onChange={(e) => setCollection({ ...collection, supply: Number(e.target.value) })} />
              </Field>
            )}

            {/* Name template with info */}
            <div>
              <div className="mb-1 flex items-center gap-1 text-sm text-white/60">
                Name template
                <Info tip={`Controls how each NFT in the collection is named on-chain.\n\nAvailable placeholders:\n• {name}: the collection name\n• {id}: the token number\n\nExample: "Dough Boi #{id}" produces "Dough Boi #1", "Dough Boi #2", etc.`} />
              </div>
              <input className="input" value={collection.nameTemplate}
                onChange={(e) => setCollection({ ...collection, nameTemplate: e.target.value })} />
              <p className="mt-1 text-xs text-white/40">
                Preview: {collection.nameTemplate.replace("{name}", collection.name || "Collection").replace("{id}", "42")}
              </p>
            </div>

            {/* Royalty scheme */}
            <div className="border-t border-white/10 pt-4">
              <div className="mb-3 flex items-center gap-1 text-sm font-medium text-white">
                Secondary royalty scheme
                <Info tip="Royalties are paid when an NFT is resold on the secondary market. Set the total % and choose how it's distributed. Holder and buyback portions are routed to platform-managed treasury contracts." />
              </div>

              {/* Total royalty % */}
              <div className="mb-4 flex items-center gap-3">
                <label className="text-sm text-white/70">Total royalty</label>
                <div className="flex items-center gap-1">
                  <input
                    type="number" min={0} max={25} step={0.5}
                    value={royaltyBps / 100}
                    onChange={(e) => setRoyaltyBps(Math.round(Number(e.target.value) * 100))}
                    className="input w-20 text-center"
                  />
                  <span className="text-sm text-white/60">%</span>
                </div>
                <span className="text-xs text-white/40">of every secondary sale, recommended 5–10%</span>
              </div>

              {/* Split checkboxes */}
              <p className="mb-2 text-xs text-white/50">Distribute royalties to:</p>
              <div className="space-y-3">
                {/* Owner */}
                <div className="rounded-lg border border-white/10 p-3">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={royaltyOwner}
                      onChange={(e) => {
                        setRoyaltyOwner(e.target.checked);
                        if (!e.target.checked) setRoyaltySplit({ ...royaltySplit, ownerPercent: 0 });
                        else setRoyaltySplit({ ...royaltySplit, ownerPercent: 100 - (royaltyHolders ? royaltySplit.holdersPercent : 0) - (royaltyBuyback ? royaltySplit.buybackPercent : 0) });
                      }} />
                    <span className="text-sm font-medium text-white">Creator / Owner wallet</span>
                    <Info tip="Royalties go directly to the creator wallet you set. This is the standard Metaplex royalty flow, enforced on-chain via the Royalties Plugin." />
                  </label>
                  {royaltyOwner && (
                    <div className="mt-2 flex items-center gap-2 pl-6">
                      <input type="number" min={0} max={100} value={royaltySplit.ownerPercent}
                        onChange={(e) => setRoyaltySplit({ ...royaltySplit, ownerPercent: Number(e.target.value) })}
                        className="input w-20 text-sm" />
                      <span className="text-xs text-white/60">% of royalty → creator wallet</span>
                    </div>
                  )}
                </div>

                {/* Holders */}
                <div className="rounded-lg border border-white/10 p-3">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={royaltyHolders}
                      onChange={(e) => {
                        setRoyaltyHolders(e.target.checked);
                        if (!e.target.checked) setRoyaltySplit({ ...royaltySplit, holdersPercent: 0 });
                      }} />
                    <span className="text-sm font-medium text-white">NFT holders share</span>
                    <Info tip="A portion of every secondary sale goes to a holder-distribution treasury. At each fee_distribution milestone, holders claim their proportional share based on how many NFTs they hold." />
                  </label>
                  {royaltyHolders && (
                    <div className="mt-2 flex items-center gap-2 pl-6">
                      <input type="number" min={0} max={100} value={royaltySplit.holdersPercent}
                        onChange={(e) => setRoyaltySplit({ ...royaltySplit, holdersPercent: Number(e.target.value) })}
                        className="input w-20 text-sm" />
                      <span className="text-xs text-white/60">% of royalty → holder treasury</span>
                    </div>
                  )}
                </div>

                {/* Buyback */}
                <div className="rounded-lg border border-white/10 p-3">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={royaltyBuyback}
                      onChange={(e) => {
                        setRoyaltyBuyback(e.target.checked);
                        if (!e.target.checked) setRoyaltySplit({ ...royaltySplit, buybackPercent: 0 });
                      }} />
                    <span className="text-sm font-medium text-white">Floor buyback treasury</span>
                    <Info tip="A portion goes to a buyback treasury that periodically purchases NFTs from the secondary market at or near the floor price, helping maintain price stability for your collection." />
                  </label>
                  {royaltyBuyback && (
                    <div className="mt-2 space-y-2 pl-6">
                      <div className="flex items-center gap-2">
                        <input type="number" min={0} max={100} value={royaltySplit.buybackPercent}
                          onChange={(e) => setRoyaltySplit({ ...royaltySplit, buybackPercent: Number(e.target.value) })}
                          className="input w-20 text-sm" />
                        <span className="text-xs text-white/60">% of royalty → buyback treasury</span>
                      </div>
                    </div>
                  )}
                </div>

                {buybackEnabled && (
                  <div className="rounded-lg border border-[#f5c542]/30 bg-[#f5c542]/5 p-3">
                    <Field label="Buyback token CA (contract address)">
                      <input
                        className="input font-mono text-sm"
                        placeholder="Solana SPL mint address, e.g. Tokenkeg..."
                        value={collection.buybackTokenCa ?? ""}
                        onChange={(e) =>
                          setCollection({ ...collection, buybackTokenCa: e.target.value.trim() })
                        }
                      />
                    </Field>
                    <p className="mt-1 text-xs text-white/50">
                      Required when buyback is enabled. The treasury uses this token for floor buybacks and holder
                      rewards tied to the buyback program.
                    </p>
                  </div>
                )}

                {/* Split validation */}
                {(royaltyOwner || royaltyHolders || royaltyBuyback) && (
                  <p className={`text-xs font-semibold ${royaltySplitTotal === 100 ? "text-emerald-400" : "text-red-400"}`}>
                    Split total: {royaltySplitTotal}%
                    {royaltySplitTotal !== 100 && `. Needs ${100 - royaltySplitTotal > 0 ? "+" : ""}${100 - royaltySplitTotal}% more`}
                  </p>
                )}
              </div>
            </div>

            {/* Socials */}
            <div className="border-t border-white/10 pt-4">
              <p className="mb-3 text-sm font-medium text-white/70">Socials</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {([
                  ["twitter",  "X / Twitter",  "https://x.com/yourproject"],
                  ["discord",  "Discord",       "https://discord.gg/..."],
                  ["telegram", "Telegram",      "https://t.me/..."],
                  ["website",  "Website",       "https://..."],
                ] as const).map(([key, label, placeholder]) => (
                  <Field key={key} label={label}>
                    <input className="input" placeholder={placeholder}
                      value={collection.socials?.[key] ?? ""}
                      onChange={(e) =>
                        setCollection({ ...collection, socials: { ...collection.socials, [key]: e.target.value } })
                      } />
                  </Field>
                ))}
              </div>
            </div>

            {/* Thumbnail strip */}
            {collection.tokens.length > 0 && (
              <div className="mt-2 grid grid-cols-6 gap-1.5">
                {collection.tokens.slice(0, 12).map((t) => (
                  <div key={t.tokenId} className="aspect-square overflow-hidden rounded-lg bg-white/5">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={tokenImageSrc(collection, t)} alt={`#${t.tokenId}`}
                      className="h-full w-full object-cover" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* ── Traits rarity + price modifiers ── */}
        {stepIs("Traits") && collection && (
          <div className="space-y-6">
            <div>
              <h2 className="text-lg font-semibold text-white">Trait rarity &amp; pricing</h2>
              <p className="mt-1 text-sm text-white/60">
                Assign each trait value a rarity tier and an optional price modifier. Each NFT&apos;s
                mint price is base price + sum of its traits&apos; price modifiers.
              </p>
              <div className="mt-3 flex flex-wrap gap-3 text-xs">
                <span className="rounded-full bg-white/10 px-2 py-0.5 text-white/60">Common</span>
                <span className="rounded-full bg-[#f5c542]/10 px-2 py-0.5 text-[#f5c542]">Rare</span>
                <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">Epic</span>
              </div>
            </div>

            {uniqueTraits.length === 0 ? (
              <p className="text-sm text-white/50">
                No traits found in this collection&apos;s metadata. Add JSON metadata files to your ZIP to enable trait pricing.
              </p>
            ) : (
              uniqueTraits.map(({ traitType, values }) => (
                <div key={traitType}>
                  <div className="mb-3 text-sm font-semibold text-white">{traitType}</div>
                  <div className="space-y-2">
                    {values.map((val) => {
                      const pricing = collection.traitPricing?.[traitType]?.[val] ??
                        { rarity: "common" as TraitRarity, priceModifier: 0 };
                      return (
                        <div key={val} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 px-3 py-2">
                          <span className="min-w-[120px] truncate text-sm text-white">{val}</span>
                          <div className="flex gap-1">
                            {RARITY_TIERS.map((tier) => (
                              <button key={tier} type="button"
                                onClick={() => setTraitRarity(traitType, val, tier)}
                                className={`rounded-full px-2 py-0.5 text-xs capitalize transition ${
                                  pricing.rarity === tier ? RARITY_COLOR[tier] : "bg-white/5 text-white/30 hover:bg-white/10"
                                }`}>
                                {tier}
                              </button>
                            ))}
                          </div>
                          <label className="ml-auto flex items-center gap-1.5 text-xs text-white/60">
                            <span>+$</span>
                            <input type="number" min={0} step={0.01} value={pricing.priceModifier}
                              onChange={(e) => setTraitPriceModifier(traitType, val, Number(e.target.value))}
                              className="input w-20 py-1 text-xs" />
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}

        {/* ── Payments ── */}
        {stepIs("Payments") && collection && (
          <div className="space-y-4 text-sm">
            <h2 className="text-lg font-semibold text-white">Payment settings</h2>
            <Field label="Base mint price (USD)">
              <input type="number" min={0} step={0.01} className="input"
                value={collection.payments.basePriceUsd}
                onChange={(e) => setCollection({ ...collection, payments: { ...collection.payments, basePriceUsd: Number(e.target.value) } })}
              />
            </Field>
            <p className="text-xs text-white/50">Accepted payment methods</p>
            {([
              ["acceptSol",      "SOL (billed at spot price in SOL)"],
              ["acceptUsdc",     "USDC (1:1 with USD price)"],
              ["acceptPizza",    "SPL or meme coin (same USD value, no discount)"],
              ["acceptSlicePay", "SlicePay hosted checkout (credit card / crypto)"],
              ["giftMintEnabled","Allow gift mint (buyer can specify a recipient wallet)"],
            ] as const).map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-white/80">
                <input type="checkbox" checked={Boolean(collection.payments[key])}
                  onChange={(e) => setCollection({ ...collection, payments: { ...collection.payments, [key]: e.target.checked, pizzaDiscountPercent: 0 } })}
                />
                {label}
              </label>
            ))}
            {!publicKey ? (
              <button onClick={() => void connect()} className="text-primary underline text-xs">Connect wallet to set payout address</button>
            ) : (
              <p className="text-xs text-white/50">Payout wallet: {publicKey.slice(0, 8)}…{publicKey.slice(-6)}</p>
            )}
          </div>
        )}

        {/* ── Fees ── */}
        {stepIs("Fees") && collection && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Primary mint revenue split</h2>
              <p className="mt-1 text-sm text-white/60">
                How your share of each mint is divided among creator, holders, and buyback treasury.
                Must sum to 100%. Locks permanently at launch.
              </p>
            </div>

            <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-white/60">
              <p className="font-medium text-white/80">Crypgo marketplace fees (fixed, not part of your split)</p>
              <p className="mt-1">
                Primary: {PRIMARY_PLATFORM_FEE_PERCENT}% platform + {PRIMARY_TRADE_TAX_PERCENT}% trade tax
                ({PRIMARY_PLATFORM_TOTAL_PERCENT}% total, deducted before your split)
              </p>
              <p>Secondary: {SECONDARY_PLATFORM_FEE_PERCENT}% on resales</p>
              <p className="mt-1 text-white/40">No launch fee. Payment processing is covered by Crypgo.</p>
            </div>

            {/* Visual bar */}
            <div className="flex h-3 overflow-hidden rounded-full border border-white/15">
              <div className="bg-primary transition-all" style={{ width: `${collection.fees.ownerPercent}%` }} />
              <div className="bg-white/70 transition-all" style={{ width: `${collection.fees.holdersPercent}%` }} />
              <div className="bg-[#f5c542] transition-all" style={{ width: `${collection.fees.buybackPercent}%` }} />
            </div>
            <div className="flex flex-wrap gap-3 text-xs text-white/60">
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 bg-primary" />Creator</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 bg-white/70" />Holders</span>
              <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 bg-[#f5c542]" />Buyback</span>
            </div>

            {(["ownerPercent", "holdersPercent", "buybackPercent"] as const).map((key) => {
              const labels: Record<string, string> = {
                ownerPercent:   "Creator %",
                holdersPercent: "Holders %",
                buybackPercent: "Buyback treasury %",
              };
              return (
                <Field key={key} label={labels[key]}>
                  <input type="number" min={0} max={100} className="input"
                    value={collection.fees[key]}
                    onChange={(e) => setCollection({ ...collection, fees: { ...collection.fees, [key]: Number(e.target.value) } })}
                  />
                </Field>
              );
            })}
            <p className={`text-xs font-semibold ${feesTotal === 100 ? "text-emerald-400" : "text-red-400"}`}>
              Split total: {feesTotal}%{feesTotal !== 100 && ` (${100 - feesTotal > 0 ? `need +${100 - feesTotal}%` : `over by ${feesTotal - 100}%`})`}
            </p>

            {collection.fees.buybackPercent > 0 && !royaltyBuyback && (
              <div className="rounded-lg border border-[#f5c542]/30 bg-[#f5c542]/5 p-3">
                <Field label="Buyback token CA (contract address)">
                  <input
                    className="input font-mono text-sm"
                    placeholder="Solana SPL mint address"
                    value={collection.buybackTokenCa ?? ""}
                    onChange={(e) =>
                      setCollection({ ...collection, buybackTokenCa: e.target.value.trim() })
                    }
                  />
                </Field>
                <p className="mt-1 text-xs text-white/50">
                  Required when primary mint fees include a buyback treasury share.
                </p>
              </div>
            )}
          </div>
        )}

        {/* ── Reveal ── */}
        {stepIs("Reveal") && collection && (
          <div className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold text-white">Reveal settings</h2>
              <p className="mt-1 text-sm text-white/60">
                Blind mints hide what each NFT looks like until you reveal. Choose when traits become public.
              </p>
            </div>

            <label className="flex items-center gap-2 text-sm text-white">
              <input type="checkbox" checked={collection.blindMint}
                onChange={(e) => setCollection({ ...collection, blindMint: e.target.checked })} />
              Blind mint
              <span className="text-white/50">(buyers see a placeholder image until reveal)</span>
            </label>

            <div>
              <label className="mb-2 block text-sm text-white/60">Reveal trigger</label>
              <div className="space-y-2">
                {(
                  [
                    ["manual",      "Manual", "You click 'Reveal' in your creator dashboard whenever you&apos;re ready."],
                    ["at_percent",  "At % sold", "Reveal automatically when a percentage of the supply has been minted."],
                    ["at_sold_out", "At sell-out", "Reveal only after every NFT in the collection has been minted."],
                    ["at_datetime", "At a specific date & time", "Reveal on a fixed date and time regardless of mint progress."],
                    ["staggered",   "Staggered", "Reveal tokens in batches as minting progresses."],
                  ] as const
                ).map(([val, label, desc]) => (
                  <div key={val}
                    className={`rounded-lg border px-4 py-3 cursor-pointer transition ${
                      collection.revealTrigger === val
                        ? "border-primary/60 bg-primary/5"
                        : "border-white/10 hover:border-white/20"
                    }`}
                    onClick={() => setCollection({ ...collection, revealTrigger: val })}
                  >
                    <label className="flex cursor-pointer items-center gap-2">
                      <input type="radio" name="revealTrigger" value={val} readOnly
                        checked={collection.revealTrigger === val}
                        className="accent-primary" />
                      <span className="text-sm font-medium text-white">{label}</span>
                    </label>
                    <p className="mt-1 pl-6 text-xs text-white/50">
                      {desc.replace(/&apos;/g, "'")}
                    </p>

                    {/* Dynamic params */}
                    {collection.revealTrigger === val && val === "at_percent" && (
                      <div className="mt-3 pl-6">
                        <label className="text-xs text-white/60">Reveal when % sold reaches</label>
                        <div className="mt-1 flex items-center gap-2">
                          <input type="number" min={1} max={100} className="input w-24"
                            value={collection.revealAtPercent ?? 50}
                            onChange={(e) => setCollection({ ...collection, revealAtPercent: Number(e.target.value) })} />
                          <span className="text-sm text-white/60">%</span>
                        </div>
                      </div>
                    )}
                    {collection.revealTrigger === val && val === "at_datetime" && (
                      <div className="mt-3 pl-6">
                        <label className="text-xs text-white/60">Reveal date &amp; time</label>
                        <input type="datetime-local" className="input mt-1"
                          value={collection.revealAt ?? ""}
                          onChange={(e) => setCollection({ ...collection, revealAt: e.target.value })} />
                      </div>
                    )}
                    {collection.revealTrigger === val && val === "staggered" && (
                      <div className="mt-3 pl-6">
                        <p className="text-xs text-white/50">
                          Tokens reveal in batches of ~10% as minting progresses. The first batch reveals at 10% sold, the second at 20%, and so on.
                        </p>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── Milestones ── */}
        {stepIs("Milestones") && collection && (() => {
          const categories = [...new Set(MILESTONE_EVENTS.map((e) => e.category))];
          return (
            <div className="space-y-5">
              <div>
                <h2 className="text-lg font-semibold text-white">Milestones</h2>
                <p className="mt-1 text-sm text-white/60">
                  Automatically trigger marketplace actions when a % of supply is minted. Add multiple
                  milestones to schedule a progression of events.
                </p>
              </div>

              {collection.milestones.map((m, idx) => (
                <div key={idx} className="rounded-xl border border-white/15 bg-white/5 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <label className="text-xs font-medium text-white/60">Execute at % minted</label>
                      <div className="mt-1 flex items-center gap-2">
                        <input type="number" min={1} max={100} className="input w-28" value={m.at}
                          onChange={(e) => {
                            const ms = [...collection.milestones];
                            ms[idx] = { ...m, at: Number(e.target.value) };
                            setCollection({ ...collection, milestones: ms });
                          }} />
                        <span className="text-sm text-white/60">%</span>
                      </div>
                    </div>
                    <button type="button"
                      onClick={() => removeMilestone(idx)}
                      className="mt-0.5 rounded-lg border border-white/10 px-2 py-1 text-xs text-white/40 hover:border-primary/40 hover:text-primary">
                      Remove
                    </button>
                  </div>

                  <div className="mt-4 space-y-4">
                    {categories.map((cat) => {
                      const evs = MILESTONE_EVENTS.filter((e) => e.category === cat);
                      return (
                        <div key={cat}>
                          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-white/40">{cat}</p>
                          <div className="grid gap-2 sm:grid-cols-2">
                            {evs.map((ev) => (
                              <label key={ev.id} className="flex items-start gap-2 rounded-lg border border-white/5 p-2 hover:border-white/10 cursor-pointer">
                                <input type="checkbox" className="mt-0.5 shrink-0 accent-primary"
                                  checked={m.events.includes(ev.id)}
                                  onChange={(e) => {
                                    const ms = [...collection.milestones];
                                    const events = e.target.checked
                                      ? [...m.events, ev.id]
                                      : m.events.filter((x) => x !== ev.id);
                                    ms[idx] = { ...m, events: events as MilestoneEventId[] };
                                    setCollection({ ...collection, milestones: ms });
                                  }} />
                                <span>
                                  <span className="text-xs font-medium text-white">{ev.label}</span>
                                  {MILESTONE_DESC[ev.id] && (
                                    <span className="mt-0.5 block text-[11px] leading-relaxed text-white/45">
                                      {MILESTONE_DESC[ev.id]}
                                    </span>
                                  )}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setCollection({ ...collection, milestones: [...collection.milestones, { at: 50, events: [] }] })}
                className="rounded-lg border border-dashed border-white/20 px-4 py-2 text-sm text-white/50 hover:border-white/40 hover:text-white">
                + Add milestone
              </button>
            </div>
          );
        })()}

        {/* ── Go live ── */}
        {stepIs("Go live") && collection && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-white">Checklist &amp; go live</h2>
              <p className="mt-1 text-sm text-white/60">All items below must be green before launching.</p>
            </div>

            <ul className="space-y-1.5 text-sm">
              {checklist.map((c) => (
                <li key={c.label} className={`flex items-center gap-2 ${c.ok ? "text-emerald-400" : "text-white/50"}`}>
                  <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${c.ok ? "bg-emerald-400/20" : "border border-white/20"}`}>
                    {c.ok ? "✓" : "○"}
                  </span>
                  {c.label}
                </li>
              ))}
            </ul>

            {/* Launch cost estimate */}
            <div className="rounded-xl border border-white/15 bg-white/5 p-4">
              <h3 className="mb-3 text-sm font-semibold text-white">Estimated launch costs</h3>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between text-white/70">
                  <span>Permanent storage ({collection.tokens.length} images + metadata)</span>
                  <span>~${estimatedStorageUsd.toFixed(2)}</span>
                </div>
                <div className="flex justify-between text-white/70">
                  <span>Solana transaction fees</span>
                  <span>~$0.01</span>
                </div>
                <div className="mt-2 flex justify-between border-t border-white/10 pt-2 font-medium text-white">
                  <span>Total upfront</span>
                  <span>~${(estimatedStorageUsd + 0.01).toFixed(2)}</span>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-white/35">
                Storage is estimated at ~$0.006/MB on Arweave. No Crypgo launch fee — marketplace takes{" "}
                {PRIMARY_PLATFORM_TOTAL_PERCENT}% per mint ({PRIMARY_PLATFORM_FEE_PERCENT}% + {PRIMARY_TRADE_TAX_PERCENT}% trade tax)
                and {SECONDARY_PLATFORM_FEE_PERCENT}% on secondary sales only.
              </p>
              {estimatedMintRevenue > 0 && (
                <p className="mt-1 text-[11px] text-emerald-400/70">
                  Full sell-out ≈ $
                  {(
                    estimatedMintRevenue *
                    (1 - PRIMARY_PLATFORM_TOTAL_PERCENT / 100) *
                    (collection.fees.ownerPercent / 100)
                  ).toFixed(0)}{" "}
                  to creator wallet (before holder/buyback split).
                </p>
              )}
            </div>

            {/* Early access allowlist */}
            <div className="rounded-xl border border-white/15 bg-white/5 p-4">
              <div className="mb-2 flex items-center gap-1">
                <h3 className="text-sm font-semibold text-white">Early access allowlist</h3>
                <Info tip="Wallets on the allowlist can mint before the public mint opens. Useful for team members, contest winners, and early supporters. Leave empty to start with public mint open to everyone." />
              </div>
              <p className="mb-3 text-xs text-white/50">
                Add wallet addresses that can mint early. Leave empty for immediate public mint. One wallet per line or comma-separated.
              </p>
              <textarea className="input min-h-20" placeholder="Optional. Leave empty to skip." value={allowlistText}
                onChange={(e) => setAllowlistText(e.target.value)} />
              <button className="mt-2 text-xs text-primary underline"
                onClick={async () => {
                  if (!allowlistText.trim() || !collection || !publicKey) return;
                  setAllowlistMsg(null);
                  try {
                    const headers = {
                      "Content-Type": "application/json",
                      ...(await buildAuthHeaders(publicKey)),
                    };
                    const res = await fetch(`/api/collections/${collection.id}`, {
                      method: "POST",
                      headers,
                      body: JSON.stringify({ action: "allowlist", wallets: allowlistText }),
                    });
                    const data = await res.json();
                    if (!res.ok) throw new Error(data.error);
                    setCollection(data.collection);
                    setAllowlistMsg("Allowlist saved.");
                  } catch (e) {
                    setAllowlistMsg(e instanceof Error ? e.message : "Allowlist save failed");
                  }
                }}>
                Save allowlist
              </button>
              {allowlistMsg && (
                <p className="mt-1 text-xs text-white/50">{allowlistMsg}</p>
              )}
            </div>

            <button disabled={busy || !checklist.every((c) => c.ok)} onClick={() => void goLive()}
              className="w-full rounded-xl bg-primary py-3.5 text-sm font-semibold text-white disabled:opacity-40">
              {busy ? "Publishing to Arweave & going live…" : "🚀 Go live"}
            </button>
            <p className="text-center text-xs text-white/35">
              Fees lock permanently at launch. You can still update socials, name, and description after going live.
            </p>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-8 flex justify-between">
          <button disabled={step === 0} onClick={() => setStep((s) => Math.max(0, s - 1))}
            className="text-sm text-white/40 disabled:opacity-0">
            ← Back
          </button>
          {step < STEPS.length - 1 && (
            <button
              disabled={!collection || busy}
              onClick={async () => {
                if (publicKey && collection) {
                  setBusy(true);
                  try {
                    await persistDraft();
                    setStep((s) => s + 1);
                  } finally {
                    setBusy(false);
                  }
                } else {
                  setStep((s) => s + 1);
                }
              }}
              className="rounded-lg bg-white/10 px-5 py-2 text-sm text-white disabled:opacity-40 hover:bg-white/15"
            >
              Next →
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block text-white/60">{label}</span>
      {children}
    </label>
  );
}
