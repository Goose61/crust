import type { Collection, LaunchDraftState } from "@/lib/types";

export const LAUNCH_WIZARD_VERSION = 2;

export function launchResumeStorageKey(wallet: string): string {
  return `launchDraft:${wallet}`;
}

export function rememberLaunchDraft(wallet: string, collectionId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(launchResumeStorageKey(wallet), collectionId);
}

export function readRememberedLaunchDraft(wallet: string): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(launchResumeStorageKey(wallet));
}

export function isContinuableLaunch(c: Collection): boolean {
  return c.status === "draft" || c.status === "importing";
}

export function buildInitialLaunchDraft(
  mode: LaunchDraftState["mode"],
  royaltyBps = 500,
): LaunchDraftState {
  return {
    step: 0,
    mode,
    wizardVersion: LAUNCH_WIZARD_VERSION,
    royaltyBps,
    royaltySplit: { ownerPercent: 100, holdersPercent: 0, buybackPercent: 0 },
    royaltyOwner: true,
    royaltyHolders: false,
    royaltyBuyback: false,
  };
}
