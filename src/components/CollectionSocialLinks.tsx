"use client";

import { Icon } from "@iconify/react";
import type { CollectionSocials } from "@/lib/types";

const SOCIALS: {
  key: keyof CollectionSocials;
  label: string;
  icon: string;
  hover: string;
}[] = [
  { key: "twitter", label: "X", icon: "fa6-brands:x-twitter", hover: "hover:border-white/40 hover:text-white" },
  { key: "discord", label: "Discord", icon: "fa6-brands:discord", hover: "hover:border-[#5865F2]/60 hover:text-[#8ea1ff]" },
  { key: "telegram", label: "Telegram", icon: "fa6-brands:telegram", hover: "hover:border-[#2AABEE]/60 hover:text-[#7fd0f5]" },
  { key: "website", label: "Website", icon: "mdi:web", hover: "hover:border-primary/60 hover:text-primary" },
];

export function CollectionSocialLinks({
  socials,
}: {
  socials?: CollectionSocials;
}) {
  const links = SOCIALS.filter((item) => socials?.[item.key]);
  if (links.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-2">
      {links.map((item) => (
        <a
          key={item.key}
          href={socials![item.key]}
          target="_blank"
          rel="noreferrer"
          aria-label={item.label}
          title={item.label}
          className={`inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/5 text-white/80 transition-colors ${item.hover}`}
        >
          <Icon icon={item.icon} width={16} height={16} />
        </a>
      ))}
    </div>
  );
}
