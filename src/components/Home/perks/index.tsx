import { perksData } from "@/app/api/data";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";

const Perks = () => {
  return (
    <section className="pb-28 relative">
      <div className="container px-4 relative z-2">
        <div className="text-center">
          <div className="flex flex-col gap-4">
            <p className="relative text-base text-white">
              After <span className="text-primary">mint</span>
            </p>
            <h2 className="text-3xl font-medium text-white sm:text-5xl">
              Tools that stay useful after sell-out
            </h2>
          </div>
          <div className="mt-16 border border-white/10 grid lg:grid-cols-3 sm:grid-cols-2 py-16 gap-10 px-20 rounded-3xl sm:bg-perk bg-white/5 lg:bg-bottom bg-center bg-no-repeat">
            {perksData.map((item, index) => (
              <Card
                key={index}
                className="text-center flex items-center justify-end flex-col bg-transparent border-none shadow-none ring-0 p-0"
              >
                <CardContent className="p-0 flex flex-col items-center justify-end">
                  <div className="bg-primary/25 backdrop-blur-xs p-4 rounded-full w-fit">
                    <Image
                      src={item.icon}
                      alt={item.title}
                      width={44}
                      height={44}
                    />
                  </div>
                  <h3 className={`text-white text-28 mb-4 ${item.space}`}>
                    {item.title}
                  </h3>
                  <p className="text-white/60">{item.text}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
};

export default Perks;
