"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWallet } from "@/components/WalletProvider";
import { isLaunchedCreatorCollection } from "@/lib/creator-access";

export function CreatorDashboardLink({
  className,
  onNavigate,
}: {
  className: string;
  onNavigate?: () => void;
}) {
  const { publicKey } = useWallet();
  const path = usePathname();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!publicKey) {
      setVisible(false);
      return;
    }
    let cancelled = false;
    fetch("/api/collections")
      .then((r) => r.json())
      .then((d: { collections?: { status?: string; payments?: { creatorWallet?: string } }[] }) => {
        if (cancelled) return;
        setVisible(
          (d.collections ?? []).some((c) =>
            isLaunchedCreatorCollection(c, publicKey),
          ),
        );
      })
      .catch(() => {
        if (!cancelled) setVisible(false);
      });
    return () => {
      cancelled = true;
    };
  }, [publicKey]);

  if (!visible) return null;

  return (
    <Link
      href="/dashboard"
      onClick={onNavigate}
      className={`${className} ${path === "/dashboard" ? "text-primary" : ""}`}
    >
      Dashboard
    </Link>
  );
}
