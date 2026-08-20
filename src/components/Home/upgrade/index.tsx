import { upgradeData } from "@/app/api/data";
import Image from "next/image";
import { Icon } from "@iconify/react";

const Upgrade = () => {
  return (
    <section className="py-20" id="upgrade">
      <div className="container px-4">
        <div className="grid lg:grid-cols-2 gap-10 items-center">
          <div>
            <p className="font-medium text-foreground">
              Full <span className="text-primary">service list</span>
            </p>
            <h2 className="mb-5 text-3xl font-medium text-foreground sm:text-5xl">
              Everything you need to go live
            </h2>
            <p className="mb-7 text-lg text-white/70">
              Permanent on-chain storage, programmable fees, gift mint, and spot-price SPL payments, all without sending collectors to another marketplace.
            </p>
            <div className="grid sm:grid-cols-2  text-nowrap gap-5">
              {upgradeData.map((item, index) => (
                <div key={index} className="flex gap-5">
                  <div>
                    <Icon
                      icon="la:check-circle-solid"
                      width="24"
                      height="24"
                      className="text-foreground group-hover:text-primary"
                    />
                  </div>
                  <div>
                    <h3 className="text-lg text-white/80">{item.title}</h3>
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div>
            <div className="ml-0 lg:ml-7 justify-self-center">
              <Image
                src="/images/dough/dough_surfer.webp"
                alt="Dough Boi NFT"
                width={625}
                height={580}
                className="-mr-5"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Upgrade;
