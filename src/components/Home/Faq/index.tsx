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
      "Ginger is a Solana NFT marketplace for launching collections, running primary mints, and listing secondary sales in the same product. Collections do not graduate to another site.",
  },
  {
    question: "What can I launch here?",
    answer:
      "Any collection you own. The main path is a ZIP of finished images. Optional generative trait-layer ZIPs are still available in the launch wizard. Set metadata, fees, and a USD mint price, then go live.",
  },
  {
    question: "Do I need to write metadata JSON?",
    answer:
      "No. Finished-image ZIPs can include sidecar JSON, but you can also set name, description, symbol, and royalties in the wizard. We write Metaplex metadata and compute overall rarity ranks from traits.",
  },
  {
    question: "How do collectors pay?",
    answer:
      "Creators can accept SlicePay (card / USDC) and SOL. Every method is quoted from a live SOL/USD rate against the same USD mint price. There is no meme-token discount.",
  },
  {
    question: "Where is the art stored?",
    answer:
      "Images and metadata publish permanently to Arweave via Irys when you click Go live. You pay storage from your connected wallet. Until then, files stay in your browser so you can preview the launch.",
  },
  {
    question: "What happens after a collection sells out?",
    answer:
      "It stays listed here. Sold out is a milestone. Creators can unlock a holder lounge, snapshots, and native secondary listings on this market.",
  },
  {
    question: "What fees does Ginger charge?",
    answer:
      "No launch fee unless you add Featured Market (+$50 for 14 days at the top of Market). Primary mints: 0.7% platform + 0.3% trade tax (1% total, deducted before your creator split). Secondary sales: 0.5%. You configure how your share splits across creator, holders, and buyback treasury. Payment processing is covered by Ginger — buyers and creators never see a checkout surcharge.",
  },
  {
    question: "Is there a gift mint or allowlist?",
    answer:
      "Yes. After launch, the creator dashboard can gift unminted pieces to any wallet for free (you only pay on-chain rent). Allowlist and waitlist are in the launch checklist, and buyers can gift a mint when you enable that option.",
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
