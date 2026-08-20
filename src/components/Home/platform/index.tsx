import Image from "next/image";
import Link from "next/link";
import { Button } from "@/components/ui/button";

const Platform = () => {
  return (
    <section className="relative pt-12 sm:pt-24 md:pt-28">
      <div className="container px-4">
        <div className="bg-section/10 px-16 py-14 rounded-3xl border-2 border-border grid grid-cols-12 items-center before:content-[''] before:absolute relative before:w-96 before:h-64 before:bg-start before:bg-no-repeat before:-bottom-6 overflow-hidden lg:before:right-0 before:-z-1 before:opacity-10 ">
          <div className="lg:col-span-8 col-span-12">
            <h2 className="mb-6 text-3xl text-foreground sm:text-[40px]">
              Prove the stack with your own collection
            </h2>
            <p className="text-lg text-white/70">
              Upload art, set fees, go live. Primary mint and secondary listings stay on this
              marketplace, using the same rails for every drop that follows.
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
