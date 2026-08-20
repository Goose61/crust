import { Metadata } from "next";
import Hero from "@/components/Home/Hero";
import Work from "@/components/Home/work";
import Platform from "@/components/Home/platform";
import Portfolio from "@/components/Home/portfolio";
import Upgrade from "@/components/Home/upgrade";
import Perks from "@/components/Home/perks";
import Faq from "@/components/Home/Faq";

export const metadata: Metadata = {
  title: "Dough Boi · NFT marketplace",
};

export default function Home() {
  return (
    <main>
      <Hero />
      <Work />
      <Platform />
      <Portfolio />
      <Upgrade />
      <Perks />
      <Faq />
    </main>
  );
}
