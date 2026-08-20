import React, { FC } from "react";
import Link from "next/link";
import { headerData } from "../Header/Navigation/menuData";
import { footerlabels } from "@/app/api/data";
import { Icon } from "@iconify/react";
import Logo from "../Header/Logo";

const Footer: FC = () => {
  return (
    <footer className="bg-background pt-16">
      <div className="container px-4">
        <div className="grid grid-cols-1 gap-6 pb-16 sm:grid-cols-11 sm:gap-12 md:gap-6 lg:gap-20">
          <div className="col-span-6 flex flex-col gap-6 md:col-span-6 lg:col-span-4">
            <Logo />
            <p className="text-foreground/60">
              Dough Boi marketplace: launch collections, mint on Solana, and keep secondary
              trading in-ecosystem.
            </p>
            <div className="relative z-1 flex items-center gap-6">
              <Link href="/market" className="group">
                <Icon
                  icon="mdi:storefront-outline"
                  width="24"
                  height="24"
                  className="text-foreground group-hover:text-primary"
                />
              </Link>
              <Link href="https://x.com/" className="group">
                <Icon
                  icon="fa6-brands:x-twitter"
                  width="24"
                  height="24"
                  className="text-foreground group-hover:text-primary"
                />
              </Link>
              <Link href="https://t.me/" className="group">
                <Icon
                  icon="fa6-brands:telegram"
                  width="24"
                  height="24"
                  className="text-foreground group-hover:text-primary"
                />
              </Link>
            </div>
          </div>
          <div className="col-span-6 md:col-span-3 lg:col-span-2">
            <h4 className="text-24 mb-4 font-medium text-foreground">Marketplace</h4>
            <ul>
              {headerData.map((item, index) => (
                <li key={index} className="pb-4">
                  <Link href={item.href} className="text-17 text-foreground/60 hover:text-primary">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="col-span-6 md:col-span-3 lg:col-span-2">
            <h4 className="text-24 mb-4 font-medium text-foreground">Creators</h4>
            <ul>
              {footerlabels.map((item, index) => (
                <li key={index} className="pb-4">
                  <Link href={item.herf} className="text-17 text-foreground/60 hover:text-primary">
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="col-span-6 md:col-span-4 lg:col-span-3">
            <h3 className="text-24 mb-4 font-medium text-foreground">Go live</h3>
            <p className="mb-3 text-sm text-muted-foreground">
              Upload your art and launch the first collection as a proof of concept.
            </p>
            <Link
              href="/launch"
              className="inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white"
            >
              Launch a collection
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
