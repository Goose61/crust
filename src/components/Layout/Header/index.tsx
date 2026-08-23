"use client";

import { useEffect, useState } from "react";
import { headerData } from "../Header/Navigation/menuData";
import Logo from "./Logo";
import HeaderLink from "../Header/Navigation/HeaderLink";
import MobileHeaderLink from "../Header/Navigation/MobileHeaderLink";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/components/WalletProvider";
import Link from "next/link";

const Header: React.FC = () => {
  const [navbarOpen, setNavbarOpen] = useState(false);
  const [activeHash, setActiveHash] = useState("");
  const { publicKey, connecting, connect, disconnect } = useWallet();
  const short = publicKey
    ? `${publicKey.slice(0, 4)}…${publicKey.slice(-4)}`
    : null;

  useEffect(() => {
    const handleHashChange = () => setActiveHash(window.location.hash);
    window.addEventListener("hashchange", handleHashChange);
    handleHashChange();
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, []);

  return (
    <header
      className="sticky top-0 isolate z-50 min-h-[64px] w-full backdrop-blur-[14px] sm:min-h-[72px]"
      style={{
        borderBottom: "1px solid var(--header-border)",
        background: "var(--header-bg)",
      }}
    >
      <div className="mx-auto flex min-h-[64px] w-full max-w-[1240px] items-center gap-3 px-3 sm:min-h-[72px] sm:gap-5 sm:px-4">
        <div onClick={() => setActiveHash("")} className="min-w-0 shrink cursor-pointer">
          <Logo />
        </div>
        <nav className="ml-auto hidden items-center gap-5 lg:flex">
          {headerData.map((item, index) => (
            <HeaderLink
              key={index}
              item={item}
              activeHash={activeHash}
              setActiveHash={setActiveHash}
            />
          ))}
        </nav>
        <div className="hidden items-center gap-2.5 lg:flex">
          <Button
            size="lg"
            render={<Link href="/launch" />}
            className="h-10 rounded-full border-primary bg-primary px-4 font-semibold text-white hover:bg-[#b42318]"
          >
            Launch
          </Button>
          {short ? (
            <Button
              size="lg"
              variant="outline"
              onClick={disconnect}
              className="h-10 rounded-full border-white/20 bg-transparent text-white hover:border-white/50"
            >
              {short}
            </Button>
          ) : (
            <Button
              size="lg"
              variant="outline"
              onClick={() => void connect()}
              className="h-10 rounded-full border-white/20 bg-transparent text-white hover:border-primary hover:text-primary"
            >
              {connecting ? "Connecting…" : "Connect"}
            </Button>
          )}
        </div>

        <Sheet open={navbarOpen} onOpenChange={setNavbarOpen}>
          <SheetTrigger
            render={
              <button
                className="ml-auto flex h-10 w-10 flex-col items-center justify-center gap-1.5 rounded-[10px] border border-white/20 p-2 lg:hidden"
                aria-label="Toggle mobile menu"
              />
            }
          >
            <span className="block h-[1.5px] w-4 bg-white" />
            <span className="block h-[1.5px] w-4 bg-white" />
          </SheetTrigger>
          <SheetContent
            side="right"
            className="w-full max-w-xs border-l border-white/20 bg-[#0a0908] p-0"
          >
            <div className="flex items-center justify-between p-4">
              <Logo />
            </div>
            <nav className="flex flex-col items-start p-4">
              {headerData.map((item, index) => (
                <MobileHeaderLink
                  key={index}
                  item={item}
                  activeHash={activeHash}
                  setActiveHash={setActiveHash}
                  onClick={() => setNavbarOpen(false)}
                />
              ))}
              <div className="mt-4 flex w-full flex-col gap-3">
                <Button
                  size="lg"
                  render={<Link href="/launch" />}
                  onClick={() => setNavbarOpen(false)}
                  className="w-full rounded-full bg-primary text-white"
                >
                  Launch
                </Button>
                <Button
                  size="lg"
                  variant="outline"
                  onClick={() => {
                    setNavbarOpen(false);
                    if (short) disconnect();
                    else void connect();
                  }}
                  className="w-full rounded-full border-white/20 text-white"
                >
                  {short ?? (connecting ? "Connecting…" : "Connect")}
                </Button>
              </div>
            </nav>
          </SheetContent>
        </Sheet>
      </div>
    </header>
  );
};

export default Header;
