"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  MILESTONE_EVENTS,
  type Collection,
  type GeneratedToken,
  type LayerCatalog,
  type MetadataCreator,
  type MilestoneEventId,
  type RoyaltySplit,
  type TraitPricing,
  type TraitRarity,
} from "@/lib/types";
import { tokenImageSrc } from "@/lib/collection-ui";
import { buildAuthHeaders, AUTH_TTL_MS } from "@/lib/wallet-auth-client";
import { readJsonResponse } from "@/lib/fetch-json";
import {
  assetToObjectUrl,
  clearCollectionAssets,
  estimateArweaveBytes,
  getImage,
  getLogo,
  hasAssets,
  loadUploadProgress,
  putLogo,
  saveUploadProgress,
} from "@/lib/client-asset-store";
import { parseReadyArtZip } from "@/lib/client-zip-import";
import { parseLayerZipClient } from "@/lib/client-layer-import";
import {
  generateFullCollectionClient,
  generatePreviewsClient,
  revokePreviewUrls,
} from "@/lib/client-compositor";
import {
  buildTokenMetadataForUpload,
  fetchStorageEstimate,
  newClientCollectionId,
  patchCollectionUris,
  postImportDraft,
  postImportDraftWithTokens,
  importTokenBatch,
  TOKEN_IMPORT_BATCH_SIZE,
} from "@/lib/client-launch-api";
import {
  uploadCollectionWithPhantom,
  uploadCollectionViaServer,
  payPlatformForArweaveStorage,
} from "@/lib/irys-client";
import { getClientNetwork } from "@/lib/solana-config";
import {
  CollectionUploadProgressOverlay,
  type CollectionUploadProgressState,
} from "@/components/CollectionUploadProgress";
import {
  PRIMARY_PLATFORM_FEE_PERCENT,
  PRIMARY_PLATFORM_TOTAL_PERCENT,
  PRIMARY_TRADE_TAX_PERCENT,
  SECONDARY_PLATFORM_FEE_PERCENT,
} from "@/lib/platform-fees";
import {
  applyMetadataOverrides,
  metadataReviewBlocksLaunch,
  reviewCollectionMetadata,
} from "@/lib/metadata-review";
import { tokenMetadataName } from "@/lib/metadata-builders";
import {
  buildInitialLaunchDraft,
  forgetLaunchDraft,
  isContinuableLaunch,
  rememberLaunchDraft,
  readRememberedLaunchDraft,
} from "@/lib/launch-resume";
import {
  formatSolAmount,
  SOL_USD_FALLBACK,
  usdFromDisplayInput,
  displayPriceFromUsd,
  usdToSol,
  type PriceDisplayUnit,
} from "@/lib/price-display";
import { useWallet } from "./WalletProvider";

/* ─── steps ─── */
const WIZARD_VERSION = 2;
const TOKEN_PAGE_SIZE = 25;
const PREFIX_LAYERS = ["Rarity", "Preview"] as const;
const SHARED_STEPS = [
  "Metadata",
  "Collection",
  "Traits",
  "Payments",
  "Fees",
  "Reveal",
  "Milestones",
  "Go live",
] as const;

function wizardSteps(mode: "ready" | "layers"): string[] {
  return mode === "layers" ? [...PREFIX_LAYERS, ...SHARED_STEPS] : [...SHARED_STEPS];
}

function migrateDraftStep(mode: "ready" | "layers", step: number, wizardVersion?: number): number {
  if (wizardVersion === WIZARD_VERSION) return step;
  const prefixLen = mode === "layers" ? PREFIX_LAYERS.length : 0;
  if (step < prefixLen) return step;
  if (step === prefixLen) return prefixLen;
  return step + 1;
}

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
  const map = new Map<string, Map<string, number[]>>();
  for (const t of tokens) {
    for (const a of t.attributes) {
      if (a.trait_type === "Rarity Rank") continue;
      const val = String(a.value);
      if (!map.has(a.trait_type)) map.set(a.trait_type, new Map());
      const byVal = map.get(a.trait_type)!;
      if (!byVal.has(val)) byVal.set(val, []);
      const examples = byVal.get(val)!;
      if (examples.length < 2) examples.push(t.tokenId);
    }
  }
  return Array.from(map.entries()).map(([traitType, byVal]) => ({
    traitType,
    values: Array.from(byVal.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([value, examples]) => ({ value, examples })),
  }));
}

function defaultTraitPricing(tokens: Collection["tokens"]): TraitPricing {
  const pricing: TraitPricing = {};
  for (const { traitType, values } of buildUniqueTraits(tokens)) {
    pricing[traitType] = {};
    for (const { value } of values) {
      pricing[traitType][value] = { rarity: "common", priceModifier: 0 };
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

function PriceUnitToggle({
  unit,
  onChange,
  solUsd,
}: {
  unit: PriceDisplayUnit;
  onChange: (unit: PriceDisplayUnit) => void;
  solUsd: number;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="inline-flex rounded-lg border border-white/15 p-0.5 text-xs">
        <button
          type="button"
          onClick={() => onChange("usd")}
          className={`rounded-md px-2.5 py-1 transition ${
            unit === "usd" ? "bg-primary text-white" : "text-white/50 hover:text-white"
          }`}
        >
          USD
        </button>
        <button
          type="button"
          onClick={() => onChange("sol")}
          className={`rounded-md px-2.5 py-1 transition ${
            unit === "sol" ? "bg-primary text-white" : "text-white/50 hover:text-white"
          }`}
        >
          SOL
        </button>
      </div>
      <span className="text-[11px] text-white/40">1 SOL ≈ ${solUsd.toFixed(2)}</span>
    </div>
  );
}

export function LaunchWizard({ resumeId }: { resumeId?: string }) {
  const router = useRouter();
  const { publicKey, connect } = useWallet();

  const [mode, setMode] = useState<Mode>(null);
  const [step, setStep] = useState(0);
  const [busy, setBusy] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<CollectionUploadProgressState | null>(null);
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
  const [savedDrafts, setSavedDrafts] = useState<Collection[]>([]);
  const [draftsLoading, setDraftsLoading] = useState(false);
  const [draftsLoaded, setDraftsLoaded] = useState(false);
  const [needsRezip, setNeedsRezip] = useState(false);
  const [localPreviewUrls, setLocalPreviewUrls] = useState<Map<number, string>>(new Map());
  const [goLivePhase, setGoLivePhase] = useState<string | null>(null);
  const [arweaveUploadDetail, setArweaveUploadDetail] = useState<string | null>(null);
  const [tokenPage, setTokenPage] = useState(0);
  const [tokenFilter, setTokenFilter] = useState("");
  const [deletingDraftId, setDeletingDraftId] = useState<string | null>(null);
  const [priceUnit, setPriceUnit] = useState<PriceDisplayUnit>("usd");
  const [solUsd, setSolUsd] = useState(SOL_USD_FALLBACK);

  const uploadInProgressRef = useRef(false);
  const rezipInputRef = useRef<HTMLInputElement>(null);
  const collectionRef = useRef<Collection | null>(null);
  collectionRef.current = collection;

  const STEPS = mode ? wizardSteps(mode) : [];

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

  const metadataReview = useMemo(
    () => (collection ? reviewCollectionMetadata(collection) : null),
    [collection],
  );

  const filteredTokens = useMemo(() => {
    if (!collection) return [];
    const q = tokenFilter.trim();
    if (!q) return collection.tokens;
    const n = Number(q);
    if (Number.isFinite(n)) {
      return collection.tokens.filter((t) => t.tokenId === n);
    }
    return collection.tokens.filter((t) =>
      tokenMetadataName(collection, t).toLowerCase().includes(q.toLowerCase()),
    );
  }, [collection, tokenFilter]);

  const tokenPageCount = Math.max(1, Math.ceil(filteredTokens.length / TOKEN_PAGE_SIZE));
  const pagedTokens = filteredTokens.slice(
    tokenPage * TOKEN_PAGE_SIZE,
    tokenPage * TOKEN_PAGE_SIZE + TOKEN_PAGE_SIZE,
  );

  const checklist = useMemo(() => {
    if (!collection) return [];
    const artReady =
      mode === "layers"
        ? collection.layers.length > 0
        : collection.tokens.length > 0;
    return [
      { ok: artReady, label: "Art uploaded" },
      { ok: !collection.clientImport || !needsRezip, label: "Local art files in this browser" },
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
        ok: metadataReview ? !metadataReviewBlocksLaunch(metadataReview) : false,
        label: "Metadata review errors resolved",
      },
      {
        ok: !buybackEnabled || Boolean(collection.buybackTokenCa?.trim()),
        label: "Buyback token CA (contract address)",
      },
    ];
  }, [collection, publicKey, feesTotal, royaltyOwner, royaltyHolders, royaltyBuyback, royaltySplitTotal, buybackEnabled, metadataReview, mode, needsRezip]);

  const uniqueTraits = useMemo(
    () => (collection ? buildUniqueTraits(collection.tokens) : []),
    [collection],
  );

  function buildWizardPersistPatch(nextStep: number, src: Collection): Partial<Collection> {
    if (!mode) return {};
    return {
      name: src.name,
      description: src.description,
      nameTemplate: src.nameTemplate,
      symbol: src.symbol,
      supply: src.supply,
      socials: src.socials,
      logoUrl: src.logoUrl,
      payments: { ...src.payments, creatorWallet: src.payments.creatorWallet || publicKey! },
      fees: src.fees,
      blindMint: src.blindMint,
      revealTrigger: src.revealTrigger,
      revealAt: src.revealAt,
      revealAtPercent: src.revealAtPercent,
      milestones: src.milestones,
      traitPricing: src.traitPricing,
      layers: src.layers,
      stackOrder: src.stackOrder,
      royaltyBps,
      royaltySplit: {
        ownerPercent: royaltyOwner ? royaltySplit.ownerPercent : 0,
        holdersPercent: royaltyHolders ? royaltySplit.holdersPercent : 0,
        buybackPercent: royaltyBuyback ? royaltySplit.buybackPercent : 0,
      },
      royaltyCreators: src.royaltyCreators,
      metadataConfirmed: src.metadataConfirmed,
      buybackTokenCa: src.buybackTokenCa,
      launchDraft: {
        step: nextStep,
        mode,
        wizardVersion: WIZARD_VERSION,
        royaltyBps,
        royaltySplit,
        royaltyOwner,
        royaltyHolders,
        royaltyBuyback,
      },
    };
  }

  async function restoreLogoPreview(collectionId: string) {
    const logo = await getLogo(collectionId);
    if (logo) {
      setLogoPreview(URL.createObjectURL(new Blob([logo.data], { type: logo.contentType })));
    } else {
      setLogoPreview(null);
    }
    setLogoFile(null);
  }

  function applyLaunchDraft(col: Collection) {
    const draft = col.launchDraft;
    if (draft) {
      setStep(migrateDraftStep(draft.mode, draft.step, draft.wizardVersion));
      setRoyaltyBps(draft.royaltyBps ?? col.royaltyBps ?? 500);
      setRoyaltySplit(draft.royaltySplit);
      setRoyaltyOwner(draft.royaltyOwner);
      setRoyaltyHolders(draft.royaltyHolders);
      setRoyaltyBuyback(draft.royaltyBuyback);
      setMode(draft.mode);
    } else {
      setMode(col.layers.length > 0 ? "layers" : "ready");
      setStep(0);
      setRoyaltyBps(col.royaltyBps ?? 500);
    }
    const withPricing: Collection = {
      ...col,
      traitPricing: col.traitPricing ?? defaultTraitPricing(col.tokens),
    };
    setCollection(withPricing);
    setAllowlistText(col.allowlist?.join("\n") ?? "");
    void checkLocalAssets(withPricing);
    void restoreLogoPreview(col.id);
  }

  async function checkLocalAssets(col: Collection) {
    if (!col.clientImport) {
      setNeedsRezip(false);
      return;
    }
    const ok = await hasAssets(col.id);
    setNeedsRezip(!ok);
  }

  function wizardThumbnailSrc(col: Collection, token: GeneratedToken): string {
    if (col.clientImport) {
      const local = localPreviewUrls.get(token.tokenId);
      if (local) return local;
    }
    return tokenImageSrc(col, token);
  }

  useEffect(() => {
    if (!collection?.clientImport || collection.tokens.length === 0) return;
    let cancelled = false;
    const urlsToRevoke: string[] = [];

    async function loadUrls() {
      const urls = new Map<number, string>();
      for (const t of collection!.tokens.slice(0, 12)) {
        const asset = await getImage(collection!.id, t.tokenId);
        if (asset) {
          const url = assetToObjectUrl(asset);
          urls.set(t.tokenId, url);
          urlsToRevoke.push(url);
        }
      }
      if (!cancelled) setLocalPreviewUrls(urls);
    }

    void loadUrls();
    return () => {
      cancelled = true;
      for (const url of urlsToRevoke) {
        if (url.startsWith("blob:")) URL.revokeObjectURL(url);
      }
    };
  }, [collection?.id, collection?.clientImport, collection?.tokens.length]);

  useEffect(() => {
    if (!collection || !mode) return;
    const stepName = wizardSteps(mode)[step];
    if (stepName !== "Payments" && stepName !== "Traits") return;
    let cancelled = false;
    void fetch("/api/quotes?usd=1")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { quote?: { solUsd?: number } } | null) => {
        if (!cancelled && data?.quote?.solUsd) setSolUsd(data.quote.solUsd);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [collection?.id, mode, step]);

  async function bindLaunchSession(
    col: Collection,
    launchMode: "ready" | "layers",
    nextStep = 0,
    authHeaders?: Record<string, string>,
  ): Promise<Collection> {
    if (!publicKey) return col;
    rememberLaunchDraft(publicKey, col.id);
    router.replace(`/launch?id=${col.id}`, { scroll: false });

    const initial = buildInitialLaunchDraft(launchMode, col.royaltyBps ?? royaltyBps);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (publicKey) {
        Object.assign(
          headers,
          authHeaders ?? (await buildAuthHeaders(publicKey)),
        );
      }
      const res = await fetch("/api/collections", {
        method: "POST",
        headers,
        body: JSON.stringify({
          id: col.id,
          payments: { ...col.payments, creatorWallet: col.payments.creatorWallet || publicKey },
          royaltyBps: col.royaltyBps ?? royaltyBps,
          launchDraft: {
            ...initial,
            step: nextStep,
            royaltySplit,
            royaltyOwner,
            royaltyHolders,
            royaltyBuyback,
          },
        }),
      });
      const data = await readJsonResponse<{ collection: Collection; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Save failed");
      setCollection(data.collection);
      return data.collection;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save launch progress");
      return col;
    }
  }

  useEffect(() => {
    if (!resumeId || mode || uploadInProgressRef.current) return;
    let cancelled = false;

    async function loadResume() {
      if (!publicKey) {
        setError("Connect your wallet to continue this launch.");
        return;
      }
      setBusy(true);
      setError(null);
      try {
        const headers = await buildAuthHeaders(publicKey);
        const res = await fetch(`/api/collections/${resumeId}`, { headers });
        const data = await readJsonResponse<{ collection: Collection; error?: string }>(res);
        if (!res.ok) throw new Error(data.error || "Could not load draft");
        if (cancelled) return;

        let col = data.collection;
        if (col.status === "live" || col.status === "sold_out") {
          router.push(`/collection/${col.id}`);
          return;
        }
        if (col.status === "importing" && !col.clientImport) {
          setUploadProgress({
            fileName: col.name,
            fileSize: 0,
            phase: "processing",
            percent: 82,
            detail: col.importProgress
              ? `${col.importProgress.done} / ${col.importProgress.total}`
              : undefined,
          });
          const { startImportProcess, pollImportUntilReady } = await import(
            "@/lib/upload-collection-zip",
          );
          await startImportProcess(col.id, headers).catch(() => undefined);
          col = await pollImportUntilReady(
            col.id,
            { name: col.name, size: 0 },
            setUploadProgress,
          );
        }
        if (cancelled) return;
        applyLaunchDraft(col);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Could not resume launch");
        }
      } finally {
        if (!cancelled) {
          setUploadProgress(null);
          setBusy(false);
        }
      }
    }

    void loadResume();
    return () => {
      cancelled = true;
    };
  }, [resumeId, publicKey, router, mode]);

  async function loadSavedDrafts() {
    if (!publicKey) {
      await connect();
      return;
    }
    setDraftsLoading(true);
    setError(null);
    try {
      const headers = await buildAuthHeaders(publicKey);
      const res = await fetch("/api/collections", { headers });
      const data = await readJsonResponse<{ collections: Collection[] }>(res);
      const mine = (data.collections ?? []).filter(
        (c) => c.payments.creatorWallet === publicKey && isContinuableLaunch(c),
      );
      setSavedDrafts(mine);
      setDraftsLoaded(true);
    } catch (e) {
      setSavedDrafts([]);
      setError(e instanceof Error ? e.message : "Could not load saved launches");
    } finally {
      setDraftsLoading(false);
    }
  }

  async function deleteSavedLaunch(c: Collection) {
    if (!publicKey) return;
    const label = c.name || "Untitled collection";
    if (!window.confirm(`Delete "${label}"? This cannot be undone.`)) return;
    setDeletingDraftId(c.id);
    setError(null);
    try {
      const headers = await buildAuthHeaders(publicKey);
      const res = await fetch(`/api/collections/${c.id}`, {
        method: "DELETE",
        headers,
      });
      const data = await readJsonResponse<{ ok?: boolean; error?: string }>(res);
      if (!res.ok) throw new Error(data.error || "Delete failed");
      forgetLaunchDraft(publicKey, c.id);
      await clearCollectionAssets(c.id).catch(() => undefined);
      setSavedDrafts((prev) => prev.filter((d) => d.id !== c.id));
      if (collection?.id === c.id) {
        setCollection(null);
        setMode(null);
        setStep(0);
        router.replace("/launch", { scroll: false });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete launch");
    } finally {
      setDeletingDraftId(null);
    }
  }

  function updateTokenSidecar(
    tokenId: number,
    patch: Partial<NonNullable<GeneratedToken["sidecar"]>>,
  ) {
    if (!collection) return;
    setCollection({
      ...collection,
      tokens: collection.tokens.map((t) =>
        t.tokenId === tokenId
          ? {
              ...t,
              sidecar: {
                present: true,
                ...t.sidecar,
                ...patch,
              },
            }
          : t,
      ),
    });
  }

  async function saveTokenMetadata(src = collectionRef.current) {
    if (!src || !publicKey) return src;
    const metaPatch = {
      royaltyBps,
      royaltyCreators: src.royaltyCreators,
      name: src.name,
      symbol: src.symbol,
      description: src.description,
      nameTemplate: src.nameTemplate,
      metadataConfirmed: src.metadataConfirmed,
    };
    if (src.tokens.length > TOKEN_IMPORT_BATCH_SIZE) {
      const headers = await buildAuthHeaders(publicKey);
      let col = src;
      for (let i = 0; i < src.tokens.length; i += TOKEN_IMPORT_BATCH_SIZE) {
        const batch = src.tokens.slice(i, i + TOKEN_IMPORT_BATCH_SIZE);
        col = await importTokenBatch(publicKey, src.id, batch, {
          finalize: i + batch.length >= src.tokens.length,
          sidecarJsonCount: src.sidecarJsonCount,
          authHeaders: headers,
        });
      }
      return save(metaPatch, undefined, col);
    }
    return save({ ...metaPatch, tokens: src.tokens }, undefined, src);
  }

  useEffect(() => {
    if (resumeId || mode) return;
    setSavedDrafts([]);
    setDraftsLoaded(false);
  }, [resumeId, mode, publicKey]);

  async function authHeadersForUpload(): Promise<Record<string, string>> {
    if (!publicKey) {
      await connect();
      throw new Error("Connect a wallet to save this launch to your wallet");
    }
    return buildAuthHeaders(publicKey);
  }

  /* ── client-side finished-images ZIP ── */
  async function uploadReadyCollection(file: File) {
    uploadInProgressRef.current = true;
    setBusy(true);
    setError(null);
    setNeedsRezip(false);
    setUploadProgress({
      fileName: file.name,
      fileSize: file.size,
      phase: "processing",
      percent: 0,
    });
    try {
      const authHeaders = await authHeadersForUpload();
      const wallet = publicKey!;

      const collectionId = newClientCollectionId();
      const { tokens, sidecarJsonCount } = await parseReadyArtZip(
        file,
        collectionId,
        (p) => {
          const pct =
            p.phase === "reading"
              ? 5
              : p.phase === "parsing"
                ? 15
                : 20 + Math.round((p.done / Math.max(p.total, 1)) * 50);
          setUploadProgress({
            fileName: file.name,
            fileSize: file.size,
            phase: "processing",
            percent: pct,
            detail: p.phase === "storing" ? `${p.done} / ${p.total}` : undefined,
          });
        },
      );

      setUploadProgress({
        fileName: file.name,
        fileSize: file.size,
        phase: "processing",
        percent: 75,
        detail: "Saving draft to your profile…",
      });

      const col = await postImportDraftWithTokens(
        wallet,
        {
          id: collectionId,
          name: "My collection",
          tokens,
          sidecarJsonCount,
          onBatchProgress: (done, total) => {
            setUploadProgress({
              fileName: file.name,
              fileSize: file.size,
              phase: "processing",
              percent: 75 + Math.round((done / total) * 20),
              detail: `Saving metadata ${done} / ${total}`,
            });
          },
        },
        authHeaders,
      );

      const withPricing: Collection = {
        ...col,
        traitPricing: defaultTraitPricing(col.tokens),
      };
      setCollection(withPricing);
      setMode("ready");
      setRoyaltyBps(withPricing.royaltyBps ?? 500);
      setStep(0);
      await bindLaunchSession(withPricing, "ready", 0, authHeaders);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      uploadInProgressRef.current = false;
      setUploadProgress(null);
      setBusy(false);
    }
  }

  /* ── client-side trait-layer ZIP ── */
  async function uploadLayers(file: File) {
    uploadInProgressRef.current = true;
    setBusy(true);
    setError(null);
    setNeedsRezip(false);
    setUploadProgress({
      fileName: file.name,
      fileSize: file.size,
      phase: "processing",
      percent: 0,
    });
    try {
      const authHeaders = await authHeadersForUpload();
      const wallet = publicKey!;

      const collectionId = newClientCollectionId();
      const { layers, stackOrder } = await parseLayerZipClient(
        file,
        collectionId,
        (p) => {
          const pct =
            p.phase === "reading"
              ? 5
              : p.phase === "parsing"
                ? 15
                : 20 + Math.round((p.done / Math.max(p.total, 1)) * 60);
          setUploadProgress({
            fileName: file.name,
            fileSize: file.size,
            phase: "processing",
            percent: pct,
            detail: p.phase === "storing" ? `${p.done} / ${p.total}` : undefined,
          });
        },
      );

      const supply = layers.reduce(
        (acc, l) => acc * Math.max(1, l.values.length),
        1,
      );

      setUploadProgress({
        fileName: file.name,
        fileSize: file.size,
        phase: "processing",
        percent: 85,
        detail: "Saving draft…",
      });

      const col = await postImportDraft(
        wallet,
        {
          id: collectionId,
          mode: "layers",
          name: "My collection",
          layers,
          stackOrder,
          supply: Math.min(supply, 10_000),
        },
        authHeaders,
      );

      setCollection(col);
      setMode("layers");
      setStep(0);
      await bindLaunchSession(col, "layers", 0, authHeaders);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      uploadInProgressRef.current = false;
      setUploadProgress(null);
      setBusy(false);
    }
  }

  async function restoreFromRezip(file: File) {
    if (!collection || !mode) return;
    if (mode === "ready") {
      await parseReadyArtZip(file, collection.id, (p) => {
        setUploadProgress({
          fileName: file.name,
          fileSize: file.size,
          phase: "processing",
          percent: 20 + Math.round((p.done / Math.max(p.total, 1)) * 70),
          detail: `${p.done} / ${p.total}`,
        });
      });
    } else {
      await parseLayerZipClient(file, collection.id);
    }
    setNeedsRezip(false);
    setUploadProgress(null);
    await checkLocalAssets(collection);
  }
  async function save(patch: Partial<Collection> = {}, action?: string, base?: Collection) {
    const src = base ?? collectionRef.current;
    if (!src) return src;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (publicKey) {
      try {
        Object.assign(headers, await buildAuthHeaders(publicKey));
      } catch (e) {
        throw new Error(e instanceof Error ? e.message : "Sign in with your wallet to save");
      }
    }
    const res = await fetch("/api/collections", {
      method: "POST",
      headers,
      body: JSON.stringify({ id: src.id, ...patch, action }),
    });
    const data = await readJsonResponse<{ collection: Collection; error?: string }>(res);
    if (!res.ok) throw new Error(data.error || "Save failed");
    const server = data.collection;
    setCollection((prev) => {
      if (!prev || prev.id !== server.id) {
        return {
          ...server,
          ...patch,
          tokens: patch.tokens ?? server.tokens,
        };
      }
      return {
        ...server,
        ...prev,
        ...patch,
        tokens: patch.tokens ?? prev.tokens,
        payments: { ...server.payments, ...prev.payments, ...(patch.payments ?? {}) },
        fees: { ...server.fees, ...prev.fees, ...(patch.fees ?? {}) },
        socials: { ...server.socials, ...prev.socials, ...(patch.socials ?? {}) },
        milestones: patch.milestones ?? prev.milestones,
        layers: patch.layers ?? prev.layers,
        traitPricing: patch.traitPricing ?? prev.traitPricing,
        launchDraft: patch.launchDraft ?? prev.launchDraft,
      };
    });
    return { ...server, ...patch, tokens: patch.tokens ?? server.tokens } as Collection;
  }

  /** Save collection-level fields only — avoids re-uploading all NFT rows. */
  async function saveCollectionSettings(from = collectionRef.current) {
    if (!from || !publicKey) return from;
    return save(
      {
        name: from.name,
        description: from.description,
        nameTemplate: from.nameTemplate,
        symbol: from.symbol,
        royaltyBps,
        royaltyCreators: from.royaltyCreators,
      },
      undefined,
      from,
    );
  }

  function editorCreators(src: Collection): MetadataCreator[] {
    if (src.royaltyCreators && src.royaltyCreators.length > 0) return src.royaltyCreators;
    if (publicKey) return [{ address: publicKey, share: 100 }];
    return [{ address: "", share: 100 }];
  }

  function withAppliedMetadata(src: Collection): Collection {
    return applyMetadataOverrides(src, {
      royaltyBps,
      royaltyCreators: editorCreators(src),
      symbol: src.symbol,
      description: src.description,
      name: src.name,
      nameTemplate: src.nameTemplate,
    });
  }

  function collectionForGoLive(src: Collection): Collection {
    const creators = editorCreators(src);
    return {
      ...src,
      royaltyBps,
      royaltyCreators: creators,
      symbol: src.symbol,
      description: src.description,
      metadataConfirmed: true,
      tokens: src.tokens.map((token) => ({
        ...token,
        sidecar: {
          present: true,
          name: tokenMetadataName(src, token),
          symbol: src.symbol,
          description: src.description,
          sellerFeeBps: token.sidecar?.sellerFeeBps ?? royaltyBps,
          creators: token.sidecar?.creators?.length ? token.sidecar.creators : creators,
          image: token.sidecar?.image,
        },
      })),
    };
  }

  async function persistDraft(nextStep = step, src = collection) {
    if (!src || !publicKey || !mode) return;
    try {
      await save(buildWizardPersistPatch(nextStep, src), undefined, src);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save progress");
      throw e;
    }
  }

  async function navigateToStep(targetStep: number, options?: { applyMetadata?: boolean }) {
    if (targetStep === step) return;
    if (targetStep < 0 || targetStep >= STEPS.length) return;

    if (publicKey && collection && mode) {
      setBusy(true);
      try {
        let src = collection;
        if (options?.applyMetadata && STEPS[step] === "Metadata") {
          src = withAppliedMetadata(collection);
          setCollection(src);
        }
        await persistDraft(targetStep, src);
        setStep(targetStep);
      } finally {
        setBusy(false);
      }
      return;
    }

    setStep(targetStep);
  }

  async function storeLogoLocally(collectionId: string) {
    if (!logoFile) return;
    const buf = await logoFile.arrayBuffer();
    await putLogo(collectionId, buf, logoFile.type || "image/png");
  }

  /* ── generate previews (client compositor) ── */
  async function generatePreviews() {
    if (!collection) return;
    setBusy(true);
    setError(null);
    try {
      revokePreviewUrls(previews);
      const royaltySplitData: RoyaltySplit = {
        ownerPercent: royaltyOwner ? royaltySplit.ownerPercent : 0,
        holdersPercent: royaltyHolders ? royaltySplit.holdersPercent : 0,
        buybackPercent: royaltyBuyback ? royaltySplit.buybackPercent : 0,
      };
      const next = await generatePreviewsClient({
        collectionId: collection.id,
        name: collection.name,
        description: collection.description,
        nameTemplate: collection.nameTemplate,
        symbol: collection.symbol,
        supply: collection.supply,
        stackOrder: collection.stackOrder,
        layers: collection.layers,
        creatorWallet: publicKey || collection.payments.creatorWallet,
        sellerFeeBps: royaltyBps,
        royaltySplit: royaltySplitData,
        royaltyCreators: collection.royaltyCreators,
        previewCount: 12,
        uniqueness: true,
      });
      setPreviews(next);
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
    setGoLivePhase(null);
    setArweaveUploadDetail(null);
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
      const applied = collectionForGoLive(collection);
      let current: Collection = applied;
      if (applied.tokens.length > TOKEN_IMPORT_BATCH_SIZE) {
        current = (await saveTokenMetadata(applied)) ?? applied;
      }
      current =
        (await save({
          payments: { ...applied.payments, creatorWallet: payout },
          royaltyBps,
          royaltySplit: royaltySplitData,
          royaltyCreators: applied.royaltyCreators,
          metadataConfirmed: true,
          buybackTokenCa: applied.buybackTokenCa?.trim() || undefined,
          ...(applied.tokens.length <= TOKEN_IMPORT_BATCH_SIZE
            ? { tokens: applied.tokens }
            : {}),
        }, undefined, applied)) ?? current;
      if (!current) return;

      if (logoFile) await storeLogoLocally(current.id);

      if (mode === "layers" && current.tokens.length === 0) {
        setGoLivePhase("Generating collection images in your browser…");
        const generated = await generateFullCollectionClient({
          collectionId: current.id,
          name: current.name,
          description: current.description,
          nameTemplate: current.nameTemplate,
          symbol: current.symbol,
          supply: current.supply,
          stackOrder: current.stackOrder,
          layers: current.layers,
          creatorWallet: payout,
          sellerFeeBps: royaltyBps,
          royaltySplit: royaltySplitData,
          royaltyCreators: current.royaltyCreators,
          uniqueness: true,
          onProgress: (done, total) => {
            setArweaveUploadDetail(`Generating ${done} / ${total}`);
          },
        });
        current = await save({
          tokens: generated,
          traitPricing: defaultTraitPricing(generated),
        }, undefined, { ...current, tokens: generated }) ?? current;
      }

      const tokenList = current.tokens;
      if (tokenList.length === 0) {
        throw new Error("No tokens to publish");
      }

      const totalBytes = await estimateArweaveBytes(current.id, tokenList.length);
      const estimate = await fetchStorageEstimate(publicKey, current.id, totalBytes);
      const authHeaders = await buildAuthHeaders(publicKey);
      const network = await getClientNetwork();

      let paymentSignature: string | undefined;
      const useServerBulk =
        estimate.serverBulkUpload &&
        estimate.platformWallet &&
        tokenList.length > 1;

      if (useServerBulk) {
        setGoLivePhase(
          `Approve one-time storage payment (~${estimate.sol.toFixed(4)} SOL) in your wallet…`,
        );
        paymentSignature = await payPlatformForArweaveStorage(
          estimate.sol,
          estimate.platformWallet!,
          network,
        );
        setGoLivePhase("Uploading to Arweave — keep this tab open…");
      } else {
        setGoLivePhase(
          `Funding Arweave storage (~${estimate.sol.toFixed(4)} SOL) — approve in your wallet…`,
        );
      }

      const existingProgress = await loadUploadProgress(current.id);
      const uploadTokens = [];
      for (const token of tokenList) {
        const asset = await getImage(current.id, token.tokenId);
        if (!asset) {
          throw new Error(
            `Missing local image for token #${token.tokenId}. Re-select your ZIP file to restore assets.`,
          );
        }
        uploadTokens.push({
          tokenId: token.tokenId,
          imageBytes: new Uint8Array(asset.data),
          contentType: asset.contentType,
          buildMetadata: (imageUri: string) =>
            buildTokenMetadataForUpload(
              current!,
              token,
              imageUri,
              royaltyBps,
              royaltySplitData,
              current!.royaltyCreators,
            ),
        });
      }

      let logoBytes: Uint8Array | undefined;
      const logoAsset = await getLogo(current.id);
      if (logoAsset) {
        logoBytes = new Uint8Array(logoAsset.data);
      }

      if (!useServerBulk) {
        setGoLivePhase("Uploading to Arweave — keep this tab open…");
      }

      const uploaded = useServerBulk
        ? await uploadCollectionViaServer({
            collectionId: current.id,
            wallet: publicKey,
            tokens: uploadTokens,
            logoBytes,
            logoContentType: logoAsset?.contentType,
            paymentSignature: paymentSignature!,
            minSol: estimate.sol,
            authHeaders,
            existingProgress: existingProgress?.completed,
            existingLogoUri: existingProgress?.logoUri,
            onProgress: (p) => {
              if (p.phase === "uploading-logo") {
                setArweaveUploadDetail("Uploading logo…");
              } else {
                setArweaveUploadDetail(
                  p.tokenId != null
                    ? `Token #${p.tokenId} — ${p.done} / ${p.total} uploads`
                    : `${p.done} / ${p.total} uploads`,
                );
              }
            },
          })
        : await uploadCollectionWithPhantom({
            collectionId: current.id,
            tokens: uploadTokens,
            logoBytes,
            logoContentType: logoAsset?.contentType,
            network,
            existingProgress: existingProgress?.completed,
            existingLogoUri: existingProgress?.logoUri,
            onFundNeeded: () => {
              setGoLivePhase("Approve storage payment in your wallet…");
            },
            onProgress: (p) => {
              if (p.phase === "funding") {
                setGoLivePhase("Approve storage payment in your wallet…");
              } else if (p.phase === "uploading-logo") {
                setArweaveUploadDetail("Uploading logo…");
              } else {
                setArweaveUploadDetail(
                  p.tokenId != null
                    ? `Token #${p.tokenId} — ${p.done} / ${p.total} uploads`
                    : `${p.done} / ${p.total} uploads`,
                );
              }
            },
          });

      await saveUploadProgress(current.id, {
        completed: uploaded.tokens,
        logoUri: uploaded.logoUri,
      });

      const uriRows = tokenList.map((t) => {
        const u = uploaded.tokens[t.tokenId];
        if (!u) throw new Error(`Missing upload result for token #${t.tokenId}`);
        return { tokenId: t.tokenId, imageUri: u.imageUri, metadataUri: u.metadataUri };
      });

      setGoLivePhase("Saving permanent URIs…");
      current = await patchCollectionUris(publicKey, current.id, {
        tokens: uriRows,
        logoUrl: uploaded.logoUri,
        irysPublished: true,
      });

      setGoLivePhase("Creating on-chain collection…");
      current =
        (await save({ fees: { ...current.fees, locked: true } }, "go-live", current)) ?? current;
      router.push(`/collection/${current.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Go live failed");
    } finally {
      setBusy(false);
      setGoLivePhase(null);
      setArweaveUploadDetail(null);
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
  if (!mode && resumeId) {
    return (
      <>
        {uploadProgress && <CollectionUploadProgressOverlay {...uploadProgress} />}
        <div className="container mx-auto max-w-4xl px-4 py-12">
          <h1 className="text-3xl font-bold text-white">Continue launch</h1>
          <p className="mt-2 text-sm text-white/60">
            {publicKey
              ? busy
                ? "Loading your saved collection…"
                : error
                  ? "We could not restore this draft."
                  : "Restoring your draft…"
              : "Connect the wallet you used to start this launch."}
          </p>
          {error && (
            <div className="mt-4 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
              {error}
            </div>
          )}
          {!publicKey && (
            <button
              type="button"
              onClick={() => void connect()}
              className="mt-6 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white"
            >
              Connect wallet
            </button>
          )}
        </div>
      </>
    );
  }

  if (!mode) {
    return (
      <>
        {uploadProgress && <CollectionUploadProgressOverlay {...uploadProgress} />}
        <div className="container mx-auto max-w-4xl px-4 py-12">
        <h1 className="text-3xl font-bold text-white">Launch a collection</h1>
        <p className="mt-2 text-sm text-white/60">
          Connect your wallet first. ZIPs are parsed locally in your browser — nothing is uploaded
          to our servers until you go live and pay for permanent Arweave storage from your wallet.
        </p>

        {error && (
          <div className="mt-4 rounded-lg border border-primary/40 bg-primary/10 px-3 py-2 text-sm text-primary">
            {error}
          </div>
        )}

        {!publicKey && (
          <button
            type="button"
            onClick={() => void connect()}
            className="mt-6 rounded-xl bg-primary px-5 py-3 text-sm font-semibold text-white"
          >
            Connect wallet to launch
          </button>
        )}

        {publicKey && (
          <div className="mt-6 rounded-xl border border-white/15 bg-white/5 p-4 text-sm text-white/70">
            <p className="font-medium text-white">Wallet signature (not a payment)</p>
            <p className="mt-2 leading-relaxed">
              When you upload a ZIP or load saved drafts, your wallet will ask you to{" "}
              <strong className="text-white/90">sign a short message</strong> (starts with{" "}
              &quot;Dough Boi Auth&quot;). This proves you own the wallet — it does{" "}
              <strong className="text-white/90">not</strong> move SOL or charge fees. One signature
              is cached for about {Math.round(AUTH_TTL_MS / 60000)} minutes. Arweave storage is only
              paid when you click Go live.
            </p>
          </div>
        )}

        {publicKey && !draftsLoaded && !draftsLoading && (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => void loadSavedDrafts()}
              className="rounded-lg border border-white/20 px-4 py-2 text-sm text-white hover:border-white/40"
            >
              Load my saved launches
            </button>
            <p className="mt-2 text-xs text-white/40">
              Requires one wallet signature to list in-progress drafts tied to your wallet.
            </p>
          </div>
        )}

        {publicKey && (savedDrafts.length > 0 || draftsLoading) && (
          <div className="mt-8 rounded-2xl border border-primary/30 bg-primary/5 p-5">
            <h2 className="text-lg font-semibold text-white">Continue a saved launch</h2>
            <p className="mt-1 text-sm text-white/60">
              Your wallet has in-progress collections. Pick up where you left off — progress is
              saved automatically after upload.
            </p>
            {draftsLoading ? (
              <p className="mt-4 text-sm text-white/50">Loading saved launches…</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {savedDrafts.map((c) => {
                  const isRecent =
                    publicKey && readRememberedLaunchDraft(publicKey) === c.id;
                  const stepLabel =
                    c.launchDraft?.step != null && c.launchDraft.mode
                      ? wizardSteps(c.launchDraft.mode)[c.launchDraft.step]
                      : c.status === "importing"
                        ? "Importing"
                        : "Metadata";
                  return (
                    <li
                      key={c.id}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
                    >
                      <div>
                        <div className="font-medium text-white">
                          {c.name || "Untitled collection"}
                          {isRecent && (
                            <span className="ml-2 rounded-full bg-primary/20 px-2 py-0.5 text-xs text-primary">
                              Last session
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-white/50">
                          {c.status === "importing"
                            ? c.importProgress
                              ? `Importing ${c.importProgress.done}/${c.importProgress.total}`
                              : "Importing…"
                            : `${c.tokens.length} items · step: ${stepLabel}`}
                        </div>
                      </div>
                      <Link
                        href={`/launch?id=${c.id}`}
                        className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
                      >
                        Continue
                      </Link>
                      <button
                        type="button"
                        disabled={deletingDraftId === c.id}
                        onClick={() => void deleteSavedLaunch(c)}
                        className="rounded-lg border border-red-400/40 px-4 py-2 text-sm text-red-300 hover:bg-red-400/10 disabled:opacity-40"
                      >
                        {deletingDraftId === c.id ? "Deleting…" : "Delete"}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
            <p className="mt-4 text-xs text-white/40">
              All drafts are also listed on your{" "}
              <Link href="/dashboard" className="text-primary hover:underline">
                creator dashboard
              </Link>
              .
            </p>
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
              className={`mt-6 flex cursor-pointer items-center justify-center rounded-xl border border-primary/60 bg-primary/10 py-3 text-sm font-medium text-white transition hover:bg-primary/20 ${busy || !publicKey ? "pointer-events-none opacity-50" : ""}`}
            >
              {busy ? "Uploading…" : publicKey ? "Upload images ZIP" : "Connect wallet first"}
              <input type="file" accept=".zip" className="hidden" disabled={busy || !publicKey}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadReadyCollection(f); }}
              />
            </label>
            {publicKey && (
              <p className="mt-2 text-center text-xs text-white/40">
                You will be asked to sign once to save this draft (no SOL charge).
              </p>
            )}
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
              className={`mt-6 flex cursor-pointer items-center justify-center rounded-xl border border-white/20 py-3 text-sm font-medium text-white/80 transition hover:border-white/40 hover:text-white ${busy || !publicKey ? "pointer-events-none opacity-50" : ""}`}
            >
              {busy ? "Uploading…" : publicKey ? "Upload layers ZIP" : "Connect wallet first"}
              <input type="file" accept=".zip" className="hidden" disabled={busy || !publicKey}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) void uploadLayers(f); }}
              />
            </label>
            {publicKey && (
              <p className="mt-2 text-center text-xs text-white/40">
                You will be asked to sign once to save this draft (no SOL charge).
              </p>
            )}
          </div>
        </div>
      </div>
      </>
    );
  }

  /* ─────────────────────── WIZARD ─────────────────────── */
  return (
    <div className="container mx-auto max-w-4xl px-4 py-10">
      <input
        ref={rezipInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void restoreFromRezip(f);
          e.target.value = "";
        }}
      />
      {needsRezip && collection?.clientImport && (
        <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          <p className="font-medium">Local art files missing</p>
          <p className="mt-1 text-amber-100/80">
            Your draft settings are saved, but image files are stored in this browser only. Re-select
            the same ZIP to restore previews before going live.
          </p>
          <button
            type="button"
            onClick={() => rezipInputRef.current?.click()}
            className="mt-3 rounded-lg bg-amber-500/20 px-3 py-1.5 text-xs font-medium text-amber-50 hover:bg-amber-500/30"
          >
            Re-select ZIP file
          </button>
        </div>
      )}
      {goLivePhase && (
        <div className="mb-6 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-sm text-white">
          <p>{goLivePhase}</p>
          {arweaveUploadDetail && (
            <p className="mt-1 text-xs text-white/60">{arweaveUploadDetail}</p>
          )}
        </div>
      )}
      <div className="flex items-center gap-3">
        <button
          onClick={() => {
            router.replace("/launch");
            setMode(null);
            setCollection(null);
            setStep(0);
            setError(null);
            setPreviews([]);
            setLogoFile(null);
            setLogoPreview(null);
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
            onClick={() => { if (i < step) void navigateToStep(i); }}
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

        {/* ── Metadata review ── */}
        {stepIs("Metadata") && collection && metadataReview && (
          <div className="space-y-5">
            <div>
              <h2 className="text-lg font-semibold text-white">Metadata review</h2>
              <p className="mt-1 text-sm text-white/60">
                Sidecar JSON is display data. Phantom groups NFTs from the on-chain Core collection created at go-live — not from these files. Confirm royalty bps, creators, and symbol here before continuing.
              </p>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["NFTs", String(metadataReview.tokenCount)],
                ["Sidecar JSON", String(metadataReview.sidecarCount)],
                ["Unique bps", metadataReview.uniqueBps.length ? metadataReview.uniqueBps.join(", ") : "—"],
                ["Creator sets", String(metadataReview.uniqueCreatorSets.length || 0)],
              ].map(([label, value]) => (
                <div key={label} className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  <div className="text-[11px] text-white/45">{label}</div>
                  <div className="truncate text-sm font-medium text-white">{value}</div>
                </div>
              ))}
            </div>
            {metadataReview.uniqueSymbols.length > 0 && (
              <p className="text-xs text-white/50">
                Symbols: {metadataReview.uniqueSymbols.join(", ")}
              </p>
            )}

            {metadataReview.issues.length > 0 && (
              <ul className="space-y-1.5">
                {metadataReview.issues.map((issue) => (
                  <li
                    key={`${issue.code}-${issue.message}`}
                    className={`rounded-lg border px-3 py-2 text-xs ${
                      issue.severity === "error"
                        ? "border-red-400/40 bg-red-400/10 text-red-300"
                        : "border-[#f5c542]/30 bg-[#f5c542]/10 text-[#f5c542]"
                    }`}
                  >
                    {issue.severity === "error" ? "Error" : "Warning"}: {issue.message}
                  </li>
                ))}
              </ul>
            )}

            {metadataReview.samples.length > 0 && (
              <p className="text-xs text-white/45">
                Tip: if your ZIP uses 0-based JSON (<code className="text-white/60">0.json</code>…
                <code className="text-white/60">{`${Math.max(0, metadataReview.tokenCount - 1)}.json`}</code>
                ), NFT #{metadataReview.tokenCount} pairs with the highest-numbered file — re-upload the ZIP after deploy if pairing looks wrong.
              </p>
            )}

            <div className="space-y-3 border-t border-white/10 pt-4">
              <div className="flex flex-wrap items-end justify-between gap-3">
                <div>
                  <h3 className="text-sm font-medium text-white">Edit NFT metadata</h3>
                  <p className="mt-1 text-xs text-white/50">
                    Names and royalty bps below are written into each NFT&apos;s Arweave JSON at go-live.
                    Use Apply changes to all NFTs to save NFT-level edits.
                  </p>
                </div>
                <input
                  className="input w-48 text-sm"
                  placeholder="Search # or name…"
                  value={tokenFilter}
                  onChange={(e) => {
                    setTokenFilter(e.target.value);
                    setTokenPage(0);
                  }}
                />
              </div>

              <div className="overflow-x-auto rounded-lg border border-white/10">
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/5 text-white/50">
                    <tr>
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Royalty bps</th>
                      <th className="px-3 py-2 font-medium">Traits</th>
                      <th className="px-3 py-2 font-medium">JSON</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pagedTokens.map((t) => (
                      <tr key={t.tokenId} className="border-t border-white/10 text-white/80">
                        <td className="px-3 py-2">{t.tokenId}</td>
                        <td className="px-3 py-2">
                          <input
                            className="input min-w-[12rem] text-xs"
                            value={t.sidecar?.name ?? tokenMetadataName(collection, t)}
                            onChange={(e) =>
                              updateTokenSidecar(t.tokenId, { name: e.target.value })
                            }
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min={0}
                            max={10000}
                            className="input w-24 text-xs"
                            value={t.sidecar?.sellerFeeBps ?? royaltyBps}
                            onChange={(e) =>
                              updateTokenSidecar(t.tokenId, {
                                sellerFeeBps: Number(e.target.value),
                              })
                            }
                          />
                        </td>
                        <td className="px-3 py-2">{t.attributes.length}</td>
                        <td className="px-3 py-2">
                          {t.sidecar?.present ? (
                            <span className="text-emerald-400">paired</span>
                          ) : (
                            <span className="text-[#f5c542]">missing</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filteredTokens.length > TOKEN_PAGE_SIZE && (
                <div className="flex items-center justify-between text-xs text-white/50">
                  <span>
                    Showing {tokenPage * TOKEN_PAGE_SIZE + 1}–
                    {Math.min((tokenPage + 1) * TOKEN_PAGE_SIZE, filteredTokens.length)} of{" "}
                    {filteredTokens.length}
                  </span>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded border border-white/15 px-2 py-1 disabled:opacity-40"
                      disabled={tokenPage === 0}
                      onClick={() => setTokenPage((p) => Math.max(0, p - 1))}
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      className="rounded border border-white/15 px-2 py-1 disabled:opacity-40"
                      disabled={tokenPage >= tokenPageCount - 1}
                      onClick={() => setTokenPage((p) => Math.min(tokenPageCount - 1, p + 1))}
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </div>

            {metadataReview.samples.length > 0 && (
              <div className="overflow-x-auto rounded-lg border border-white/10 opacity-80">
                <p className="border-b border-white/10 bg-white/5 px-3 py-2 text-[11px] text-white/45">
                  Sample preview (first NFTs)
                </p>
                <table className="w-full text-left text-xs">
                  <thead className="bg-white/5 text-white/50">
                    <tr>
                      <th className="px-3 py-2 font-medium">#</th>
                      <th className="px-3 py-2 font-medium">Name</th>
                      <th className="px-3 py-2 font-medium">Symbol</th>
                      <th className="px-3 py-2 font-medium">Bps</th>
                      <th className="px-3 py-2 font-medium">Creators</th>
                      <th className="px-3 py-2 font-medium">Traits</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metadataReview.samples.map((s) => (
                      <tr key={s.tokenId} className="border-t border-white/10 text-white/80">
                        <td className="px-3 py-2">{s.tokenId}</td>
                        <td className="max-w-[10rem] truncate px-3 py-2">{s.name}</td>
                        <td className="px-3 py-2">{s.symbol || "—"}</td>
                        <td className="px-3 py-2">{s.sellerFeeBps ?? "—"}</td>
                        <td className="max-w-[14rem] truncate px-3 py-2 font-mono text-[10px]">
                          {s.creators?.map((c) => `${c.address.slice(0, 4)}…${c.share}`).join(", ") || (s.sidecarPresent ? "—" : "no JSON")}
                        </td>
                        <td className="px-3 py-2">{s.traitCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="border-t border-white/10 pt-4">
              <div className="mb-3 flex items-center gap-1 text-sm font-medium text-white">
                Collection-wide settings
                <Info tip="Edit the fields below, then click Apply changes to all NFTs. Names are built from the collection name + name template; symbol, description, royalty bps, and creators are copied to every NFT unless you override one in the table above." />
              </div>

              <div className="mb-4 grid gap-3 sm:grid-cols-2">
                <Field label="Collection name">
                  <input
                    className="input"
                    value={collection.name}
                    onChange={(e) =>
                      setCollection({ ...collection, name: e.target.value })
                    }
                    placeholder="My collection"
                  />
                </Field>
                <Field label="Name template">
                  <input
                    className="input font-mono text-xs"
                    value={collection.nameTemplate}
                    onChange={(e) =>
                      setCollection({ ...collection, nameTemplate: e.target.value })
                    }
                    placeholder="{name} #{id}"
                  />
                </Field>
                <Field label="Symbol">
                  <input
                    className="input"
                    maxLength={10}
                    value={collection.symbol}
                    onChange={(e) => setCollection({ ...collection, symbol: e.target.value })}
                  />
                </Field>
                <div className="flex items-end gap-3">
                  <label className="text-sm text-white/70">Secondary royalty (Metaplex)</label>
                  <div className="flex items-center gap-1">
                    <input
                      type="number"
                      min={0}
                      max={25}
                      step={0.5}
                      value={royaltyBps / 100}
                      onChange={(e) => setRoyaltyBps(Math.round(Number(e.target.value) * 100))}
                      className="input w-20 text-center"
                    />
                    <span className="text-sm text-white/60">%</span>
                  </div>
                  <span className="text-xs text-white/40">{royaltyBps} bps → all NFTs unless overridden</span>
                </div>
              </div>

              <Field label="Description">
                <textarea
                  className="input min-h-20"
                  value={collection.description}
                  onChange={(e) => setCollection({ ...collection, description: e.target.value })}
                  onBlur={() => void saveCollectionSettings()}
                />
              </Field>

              <p className="mb-2 mt-4 text-xs text-white/50">Metaplex royalty creators (max 5, shares must sum to 100)</p>
              <div className="space-y-2">
                {editorCreators(collection).map((row, idx) => (
                  <div key={idx} className="flex flex-wrap items-center gap-2">
                    <input
                      className="input min-w-[12rem] flex-1 font-mono text-xs"
                      placeholder="Solana address"
                      value={row.address}
                      onChange={(e) => {
                        const next = editorCreators(collection).map((c, i) =>
                          i === idx ? { ...c, address: e.target.value.trim() } : c,
                        );
                        setCollection({ ...collection, royaltyCreators: next });
                      }}
                    />
                    <input
                      type="number"
                      min={0}
                      max={100}
                      className="input w-20 text-sm"
                      value={row.share}
                      onChange={(e) => {
                        const next = editorCreators(collection).map((c, i) =>
                          i === idx ? { ...c, share: Number(e.target.value) } : c,
                        );
                        setCollection({ ...collection, royaltyCreators: next });
                      }}
                    />
                    <span className="text-xs text-white/40">share</span>
                    {editorCreators(collection).length > 1 && (
                      <button
                        type="button"
                        className="text-xs text-white/40 hover:text-white"
                        onClick={() =>
                          setCollection({
                            ...collection,
                            royaltyCreators: editorCreators(collection).filter((_, i) => i !== idx),
                          })
                        }
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))}
              </div>
              {editorCreators(collection).length < 5 && (
                <button
                  type="button"
                  className="mt-2 text-xs text-primary underline"
                  onClick={() =>
                    setCollection({
                      ...collection,
                      royaltyCreators: [...editorCreators(collection), { address: "", share: 0 }],
                    })
                  }
                >
                  + Add creator
                </button>
              )}
              <p
                className={`mt-2 text-xs font-semibold ${
                  editorCreators(collection).reduce((s, c) => s + Number(c.share || 0), 0) === 100
                    ? "text-emerald-400"
                    : "text-red-400"
                }`}
              >
                Creator shares: {editorCreators(collection).reduce((s, c) => s + Number(c.share || 0), 0)} / 100
              </p>

              <div className="mt-5 border-t border-white/10 pt-4">
                <div className="mb-3 flex items-center gap-1 text-sm font-medium text-white">
                  Royalty destination split
                  <Info tip="Used when building metadata creator rows if you leave Metaplex creators empty, and for off-chain fee routing. When creator addresses are filled in above, those addresses are written on-chain instead." />
                </div>
                <p className="mb-2 text-xs text-white/50">Distribute royalties to:</p>
                <div className="space-y-3">
                  <div className="rounded-lg border border-white/10 p-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={royaltyOwner}
                        onChange={(e) => {
                          setRoyaltyOwner(e.target.checked);
                          if (!e.target.checked) setRoyaltySplit({ ...royaltySplit, ownerPercent: 0 });
                          else setRoyaltySplit({ ...royaltySplit, ownerPercent: 100 - (royaltyHolders ? royaltySplit.holdersPercent : 0) - (royaltyBuyback ? royaltySplit.buybackPercent : 0) });
                        }} />
                      <span className="text-sm font-medium text-white">Creator / Owner wallet</span>
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
                  <div className="rounded-lg border border-white/10 p-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={royaltyHolders}
                        onChange={(e) => {
                          setRoyaltyHolders(e.target.checked);
                          if (!e.target.checked) setRoyaltySplit({ ...royaltySplit, holdersPercent: 0 });
                        }} />
                      <span className="text-sm font-medium text-white">NFT holders share</span>
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
                  <div className="rounded-lg border border-white/10 p-3">
                    <label className="flex items-center gap-2">
                      <input type="checkbox" checked={royaltyBuyback}
                        onChange={(e) => {
                          setRoyaltyBuyback(e.target.checked);
                          if (!e.target.checked) setRoyaltySplit({ ...royaltySplit, buybackPercent: 0 });
                        }} />
                      <span className="text-sm font-medium text-white">Floor buyback treasury</span>
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
                          placeholder="Solana SPL mint address"
                          value={collection.buybackTokenCa ?? ""}
                          onChange={(e) =>
                            setCollection({ ...collection, buybackTokenCa: e.target.value.trim() })
                          }
                        />
                      </Field>
                    </div>
                  )}
                  {(royaltyOwner || royaltyHolders || royaltyBuyback) && (
                    <p className={`text-xs font-semibold ${royaltySplitTotal === 100 ? "text-emerald-400" : "text-red-400"}`}>
                      Split total: {royaltySplitTotal}%
                      {royaltySplitTotal !== 100 && `. Needs ${100 - royaltySplitTotal > 0 ? "+" : ""}${100 - royaltySplitTotal}% more`}
                    </p>
                  )}
                </div>
              </div>

              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  const next = withAppliedMetadata(collection);
                  setCollection(next);
                  void saveTokenMetadata(next).then(() => {
                    if (publicKey) void persistDraft(step, next);
                  });
                }}
                className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-white disabled:opacity-40"
              >
                Apply changes to all NFTs
              </button>
              {collection.metadataConfirmed && (
                <p className="mt-2 text-xs text-emerald-400">Collection-wide metadata confirmed. Mixed sidecar values will not block go-live.</p>
              )}
            </div>
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
                    <img src={wizardThumbnailSrc(collection, t)} alt={`#${t.tokenId}`}
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
              <div className="flex flex-wrap items-start justify-between gap-3">
                <h2 className="text-lg font-semibold text-white">Trait rarity &amp; pricing</h2>
                <PriceUnitToggle unit={priceUnit} onChange={setPriceUnit} solUsd={solUsd} />
              </div>
              <p className="mt-1 text-sm text-white/60">
                Assign each trait value a rarity tier and an optional price modifier. Each NFT&apos;s
                mint price is base price + sum of its traits&apos; price modifiers.
                {priceUnit === "sol" && " Prices are stored in USD and converted using the live SOL rate."}
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
                    {values.map(({ value: val, examples }) => {
                      const pricing = collection.traitPricing?.[traitType]?.[val] ??
                        { rarity: "common" as TraitRarity, priceModifier: 0 };
                      return (
                        <div key={val} className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 px-3 py-2">
                          <span className="min-w-[120px] truncate text-sm text-white">{val}</span>
                          {examples.length > 0 && (
                            <span className="text-xs text-white/45" title="Example NFT numbers with this trait">
                              e.g. {examples.map((id) => `#${id}`).join(", ")}
                            </span>
                          )}
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
                            <span>{priceUnit === "usd" ? "+$" : "+SOL"}</span>
                            <input
                              type="number"
                              min={0}
                              step={priceUnit === "usd" ? 0.01 : 0.001}
                              value={displayPriceFromUsd(pricing.priceModifier, priceUnit, solUsd)}
                              onChange={(e) =>
                                setTraitPriceModifier(
                                  traitType,
                                  val,
                                  usdFromDisplayInput(Number(e.target.value), priceUnit, solUsd),
                                )
                              }
                              className="input w-24 py-1 text-xs"
                            />
                            {priceUnit === "usd" ? (
                              <span className="text-white/35">≈ {formatSolAmount(usdToSol(pricing.priceModifier, solUsd))} SOL</span>
                            ) : (
                              <span className="text-white/35">≈ ${pricing.priceModifier.toFixed(2)}</span>
                            )}
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
            <div className="flex flex-wrap items-start justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">Payment settings</h2>
              <PriceUnitToggle unit={priceUnit} onChange={setPriceUnit} solUsd={solUsd} />
            </div>
            <Field label={priceUnit === "usd" ? "Base mint price (USD)" : "Base mint price (SOL)"}>
              <input
                type="number"
                min={0}
                step={priceUnit === "usd" ? 0.01 : 0.001}
                className="input"
                value={displayPriceFromUsd(collection.payments.basePriceUsd, priceUnit, solUsd)}
                onChange={(e) =>
                  setCollection({
                    ...collection,
                    payments: {
                      ...collection.payments,
                      basePriceUsd: usdFromDisplayInput(Number(e.target.value), priceUnit, solUsd),
                    },
                  })
                }
              />
              <p className="mt-1 text-xs text-white/45">
                {priceUnit === "usd"
                  ? `≈ ${formatSolAmount(usdToSol(collection.payments.basePriceUsd, solUsd))} SOL at checkout`
                  : `≈ $${collection.payments.basePriceUsd.toFixed(2)} USD equivalent`}
              </p>
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

            <label className={`flex items-center gap-2 text-sm ${collection.revealTrigger === "disabled" ? "text-white/40" : "text-white"}`}>
              <input
                type="checkbox"
                checked={collection.blindMint}
                disabled={collection.revealTrigger === "disabled"}
                onChange={(e) => {
                  const blindMint = e.target.checked;
                  setCollection({
                    ...collection,
                    blindMint,
                    revealTrigger:
                      blindMint && collection.revealTrigger === "disabled"
                        ? "manual"
                        : collection.revealTrigger,
                    revealed: blindMint ? false : collection.revealed,
                  });
                }}
              />
              Blind mint
              <span className="text-white/50">(buyers see a placeholder image until reveal)</span>
            </label>
            {collection.revealTrigger === "disabled" && (
              <p className="text-xs text-white/45">
                Enable a reveal trigger other than Disabled to use blind mint.
              </p>
            )}

            <div>
              <label className="mb-2 block text-sm text-white/60">Reveal trigger</label>
              <div className="space-y-2">
                {(
                  [
                    ["disabled",    "Disabled", "No blind mint or scheduled reveal — all art and metadata are visible immediately."],
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
                    onClick={() => {
                      if (val === "disabled") {
                        setCollection({
                          ...collection,
                          revealTrigger: "disabled",
                          blindMint: false,
                          revealed: true,
                        });
                        return;
                      }
                      setCollection({
                        ...collection,
                        revealTrigger: val,
                        revealed: collection.blindMint ? false : collection.revealed,
                      });
                    }}
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
                Arweave storage is paid from your connected wallet at go-live (~$0.006/MB). Keep this
                tab open during upload. No Crypgo launch fee — marketplace takes{" "}
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
              {busy
                ? goLivePhase ?? "Uploading to Arweave & going live…"
                : "🚀 Go live (pay storage from wallet)"}
            </button>
            <p className="text-center text-xs text-white/35">
              Fees lock permanently at launch. You can still update socials, name, and description after going live.
            </p>
          </div>
        )}

        {/* Navigation */}
        <div className="mt-8 flex justify-between">
          <button disabled={step === 0 || busy} onClick={() => void navigateToStep(step - 1)}
            className="text-sm text-white/40 disabled:opacity-0">
            ← Back
          </button>
          {step < STEPS.length - 1 && (
            <button
              disabled={!collection || busy}
              onClick={() => void navigateToStep(step + 1, { applyMetadata: STEPS[step] === "Metadata" })}
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
