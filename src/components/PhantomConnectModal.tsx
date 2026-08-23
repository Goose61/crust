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
            Use the browser extension on desktop, or scan with the Phantom app on your phone.
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-4 py-2">
          <div className="rounded-xl bg-white p-3">
            {browseUrl ? (
              <QRCode value={browseUrl} size={168} level="M" />
            ) : (
              <div className="h-[168px] w-[168px]" />
            )}
          </div>
          <p className="text-center text-xs text-white/50">
            Scan to open this page in Phantom&apos;s in-app browser, then tap Connect.
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Button
            render={<a href={PHANTOM_EXTENSION_URL} target="_blank" rel="noopener noreferrer" />}
            className="w-full rounded-full bg-primary text-white hover:bg-primary/90"
          >
            Install browser extension
          </Button>
          <Button
            variant="outline"
            render={<a href={PHANTOM_DOWNLOAD_URL} target="_blank" rel="noopener noreferrer" />}
            className="w-full rounded-full border-white/20 text-white hover:border-white/40"
          >
            Get Phantom mobile app
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
