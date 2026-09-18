"use client";

import { useEffect, useState } from "react";
import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { featuredCarouselNfts } from "@/app/api/data";

type FeaturedItem = {
  tokenId: number;
  name: string;
  imageSrc: string;
  href: string;
};

const fallbackItems: FeaturedItem[] = featuredCarouselNfts.map((nft) => ({
  tokenId: nft.id,
  name: `Dough Boi #${nft.id}`,
  imageSrc: nft.src,
  href: `/collection/dough-boi?token=${nft.id}`,
}));

const CardSlider = () => {
  const [items, setItems] = useState<FeaturedItem[]>(fallbackItems);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/featured-art")
      .then((r) => r.json())
      .then((data: { tokens?: FeaturedItem[] }) => {
        if (!cancelled && data.tokens && data.tokens.length > 0) setItems(data.tokens);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const settings = {
    autoplay: true,
    dots: false,
    arrows: false,
    infinite: items.length > 1,
    autoplaySpeed: 1800,
    speed: 400,
    slidesToShow: Math.min(4, items.length),
    slidesToScroll: 1,
    cssEase: "ease-in-out",
    responsive: [
      { breakpoint: 479, settings: { slidesToShow: 1 } },
      { breakpoint: 992, settings: { slidesToShow: Math.min(2, items.length) } },
      { breakpoint: 1024, settings: { slidesToShow: Math.min(4, items.length) } },
    ],
  };

  return (
    <div className="flex flex-col gap-8 pt-10 sm:gap-10 sm:pt-14">
      <div className="flex flex-col items-center justify-center gap-3 px-1 text-center">
        <p className="font-medium text-foreground">
          Featured <span className="text-primary">artwork</span>
        </p>
        <h2 className="text-2xl font-medium text-foreground sm:text-5xl">
          Live Dough Boi NFTs on this marketplace
        </h2>
      </div>

      <Slider {...settings}>
        {items.map((nft) => (
          <div key={nft.tokenId} className="pr-6">
            <Link href={nft.href} className="block">
              <Card className="overflow-hidden rounded-2xl border-none bg-card p-0 shadow-none transition hover:brightness-110">
                <CardContent className="p-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={nft.imageSrc}
                    alt={nft.name}
                    width={360}
                    height={360}
                    className="aspect-square w-full rounded-xl object-cover"
                  />
                  <p className="mt-3 text-center text-sm font-medium text-foreground">
                    {nft.name}
                  </p>
                </CardContent>
              </Card>
            </Link>
          </div>
        ))}
      </Slider>
    </div>
  );
};

export default CardSlider;
