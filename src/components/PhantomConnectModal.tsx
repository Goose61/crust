"use client";

import { useMemo } from "react";
import QRCode from "react-qr-code";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  buildPhantomBrowseUrl,
  PHANTOM_DOWNLOAD_URL,
  PHANTOM_EXTENSION_URL,
} from "@/lib/phantom-connect";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function PhantomConnectModal({ open, onOpenChange }: Props) {
  const browseUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return buildPhantomBrowseUrl(window.location.href);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/15 bg-[#0a0908] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Connect Phantom</DialogTitle>
          <DialogDescription className="text-white/60">
            Phantom wallet is required to sign transactions. Choose how to connect below.
          </DialogDescription>
        </DialogHeader>

        {/* Mobile: open-in-Phantom deeplink */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <p className="text-sm font-medium text-white mb-1">On your phone?</p>
          <p className="text-xs text-white/50 mb-3">
            Tap below to open this page inside the Phantom mobile app. Your wallet will be available there.
          </p>
          <Button
            render={<a href={browseUrl} target="_blank" rel="noopener noreferrer" />}
            className="w-full rounded-full bg-primary text-white hover:bg-primary/90"
          >
            Open in Phantom app ↗
          </Button>
        </div>

        {/* Desktop: QR code to scan */}
        <div className="rounded-lg border border-white/10 bg-white/5 p-4">
          <p className="text-sm font-medium text-white mb-1">On desktop, no extension?</p>
          <p className="text-xs text-white/50 mb-3">
            Scan this QR with your phone&apos;s camera to open in Phantom&apos;s browser,
            or install the browser extension below.
          </p>
          <div className="flex justify-center">
            <div className="rounded-xl bg-white p-3">
              {browseUrl ? (
                <QRCode value={browseUrl} size={148} level="M" />
              ) : (
                <div className="h-[148px] w-[148px]" />
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-2 pt-1">
          <Button
            variant="outline"
            render={<a href={PHANTOM_EXTENSION_URL} target="_blank" rel="noopener noreferrer" />}
            className="w-full rounded-full border-white/20 text-white hover:border-white/40"
          >
            Install Phantom browser extension
          </Button>
          <Button
            variant="outline"
            render={<a href={PHANTOM_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" />}
            className="w-full rounded-full border-white/20 text-white hover:border-white/40"
          >
            Download Phantom mobile app
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
