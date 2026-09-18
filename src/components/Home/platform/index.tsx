import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const Platform = () => {
  return (
    <section className="relative pt-12 sm:pt-24 md:pt-28">
      <div className="container px-4">
        <div className="bg-section/10 relative grid grid-cols-12 items-center overflow-hidden rounded-3xl border-2 border-border px-4 py-8 before:absolute before:-bottom-6 before:-z-1 before:h-64 before:w-96 before:bg-start before:bg-no-repeat before:opacity-10 before:content-[''] sm:px-8 sm:py-14 lg:px-16 lg:before:right-0">
          <div className="lg:col-span-8 col-span-12">
            <h2 className="mb-6 text-2xl text-foreground sm:text-3xl sm:text-[40px]">
              Prove the stack with your own collection
            </h2>
            <p className="text-lg text-white/70">
              Connect a wallet, upload your ZIP, confirm metadata and fees, then pay Arweave storage
              from that wallet to go live. Mint and resale stay on this marketplace for every drop.
            </p>
          </div>
          <div className="lg:col-span-4 col-span-12">
            <div className="flex lg:justify-end lg:mt-0 mt-7 justify-center">
              <Button
                render={<Link href="/launch" />}
                className="text-21 flex h-14 items-center gap-2.5 rounded-lg border border-primary bg-primary px-5 py-6 text-lg font-medium text-foreground hover:bg-primary/80 sm:text-21"
              >
                Launch now
                <Image
                  src={"/images/icons/icon-arrow.svg"}
                  alt="icon"
                  width={20}
                  height={20}
                />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Platform;
