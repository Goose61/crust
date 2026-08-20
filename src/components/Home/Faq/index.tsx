"use client";
import React from "react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { PlusIcon } from "lucide-react";

const faqData = [
  {
    question: "What is this marketplace?",
    answer:
      "A Solana NFT marketplace for launching collections, running primary mints, and listing secondary sales in the same product. Collections do not graduate to another site.",
  },
  {
    question: "What can I launch here?",
    answer:
      "Any collection you own. Upload trait-layer folders or a ZIP of finished images, set supply and fees, then go live. Use it as a proof of concept for your own drop.",
  },
  {
    question: "Do I need to write metadata JSON?",
    answer:
      "No. If you upload trait-layer folders, the platform reads the folder names as traits, composites all combinations, writes Metaplex metadata, and ranks rarity automatically. If you already have finished images, just ZIP them up and we handle the rest.",
  },
  {
    question: "How do collectors pay?",
    answer:
      "Creators can accept SOL, USDC, a custom SPL or meme coin, and SlicePay hosted checkout. Every method is quoted at the same USD mint price. There is no discount for paying in a native or meme token.",
  },
  {
    question: "Where is the art stored?",
    answer:
      "Images and metadata publish permanently on-chain via Arweave when a storage key is configured. Until then, files stage locally so you can preview the full launch flow.",
  },
  {
    question: "What happens after a collection sells out?",
    answer:
      "It stays listed here. Sold out is a milestone. Creators can unlock a holder lounge, snapshots, and native secondary listings on this market.",
  },
  {
    question: "What fees can I set?",
    answer:
      "Split primary proceeds across creator, holders, buyback, and platform. The split locks at launch so collectors can see the rules before they mint.",
  },
  {
    question: "Is there a gift mint or allowlist?",
    answer:
      "Yes. Gift mint sends a piece to another wallet. Allowlist and waitlist are built into the launch checklist, and milestones can open public mint later.",
  },
];

const Faq = () => {
  return (
    <section id="faq" className="py-16 text-foreground">
      <div className="container">
        <div className="mx-auto px-4">
          <div className="mb-10 text-center">
            <p className="text-sm uppercase text-primary">Popular questions</p>
            <h2 className="mt-2 text-3xl font-semibold md:text-4xl">
              NFT marketplace FAQ
            </h2>
            <p className="mt-2 text-muted-foreground">Launch · mint · trade on Solana</p>
          </div>
          <Accordion className="space-y-4">
            {faqData.map((item, index) => (
              <AccordionItem
                key={index}
                value={`item-${index}`}
                className="rounded-lg border-none bg-card px-4"
              >
                <AccordionTrigger className="py-4 text-lg font-medium hover:no-underline **:data-[slot=accordion-trigger-icon]:hidden">
                  {item.question}
                  <PlusIcon className="h-6 w-6 shrink-0 transition-transform duration-200 group-aria-expanded/accordion-trigger:rotate-45" />
                </AccordionTrigger>
                <AccordionContent className="text-base text-muted-foreground">{item.answer}</AccordionContent>
              </AccordionItem>
            ))}
          </Accordion>
        </div>
      </div>
    </section>
  );
};

export default Faq;
