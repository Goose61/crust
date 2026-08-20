"use client";
import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import CardSlider from "./slider";
import BrandLogo from "../BrandLogo";
import { Button } from "@/components/ui/button";

const Hero = () => {
  const leftAnimation = {
    initial: { x: "-100%", opacity: 0 },
    animate: { x: 0, opacity: 1 },
    exit: { x: "-100%", opacity: 0 },
    transition: { duration: 0.6 },
  };

  const rightAnimation = {
    initial: { x: "100%", opacity: 0 },
    animate: { x: 0, opacity: 1 },
    exit: { x: "100%", opacity: 0 },
    transition: { duration: 0.6 },
  };

  return (
    <section className="relative overflow-hidden py-16 md:py-24" id="main-banner">
      <div className="container">
        <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
          <motion.div {...leftAnimation} className="flex flex-col items-center gap-10 lg:items-start">
            <div className="flex flex-col gap-4 text-center lg:text-left">
              <h1 className="text-4xl font-medium text-white sm:text-5xl md:text-6xl xl:text-[72px]">
                Launch, mint, and trade without leaving home.
              </h1>
              <p className="text-white/70">
                A marketplace built for creators who want the whole stack in one place: layer
                uploads, auto metadata, permanent on-chain storage, programmable fees, and secondary
                listings that never graduate away.
              </p>
            </div>
            <div className="flex items-center justify-center gap-4 md:justify-start">
              <Button
                render={<Link href="/launch" />}
                className="flex h-12 cursor-pointer items-center gap-2 rounded-lg border border-primary bg-primary px-7 py-6 text-base font-semibold text-white hover:bg-primary/80"
              >
                Launch a collection
                <Image src="/images/icons/icon-arrow.svg" alt="arrow-icon" width={20} height={20} />
              </Button>
              <Button
                render={<Link href="/market" />}
                variant="outline"
                className="h-12 rounded-lg border-white/20 px-6 text-white hover:border-white/40"
              >
                Discover drops
              </Button>
            </div>
          </motion.div>
          <motion.div {...rightAnimation} className="justify-self-center">
            <div className="relative h-full w-full max-w-[520px]">
              <Image
                src="/images/dough/dough_boi_nft_phone.png"
                alt="Dough Boi NFT"
                width={584}
                height={582}
                className="h-full w-full rounded-3xl object-contain"
              />
            </div>
          </motion.div>
        </div>
        <BrandLogo />
        <CardSlider />
      </div>
    </section>
  );
};

export default Hero;
