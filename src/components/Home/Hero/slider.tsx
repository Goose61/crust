import Slider from "react-slick";
import "slick-carousel/slick/slick.css";
import "slick-carousel/slick/slick-theme.css";
import { featuredCarouselNfts } from "@/app/api/data";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";

const CardSlider = () => {
  const settings = {
    autoplay: true,
    dots: false,
    arrows: false,
    infinite: true,
    autoplaySpeed: 1800,
    speed: 400,
    slidesToShow: 4,
    slidesToScroll: 1,
    cssEase: "ease-in-out",
    responsive: [
      { breakpoint: 479, settings: { slidesToShow: 1 } },
      { breakpoint: 992, settings: { slidesToShow: 2 } },
      { breakpoint: 1024, settings: { slidesToShow: 4 } },
    ],
  };

  return (
    <div className="flex flex-col gap-10 pt-14">
      <div className="flex flex-col items-center justify-center gap-3 text-center">
        <p className="font-medium text-foreground">
          Featured <span className="text-primary">artwork</span>
        </p>
        <h2 className="text-3xl font-medium text-foreground sm:text-5xl">
          Dough Boi NFTs on this marketplace
        </h2>
      </div>

      <Slider {...settings}>
        {featuredCarouselNfts.map((nft) => (
          <div key={nft.id} className="pr-6">
            <Card className="overflow-hidden rounded-2xl border-none bg-card p-0 shadow-none">
              <CardContent className="p-3">
                <Image
                  src={nft.src}
                  alt={`Dough Boi #${nft.id}`}
                  width={360}
                  height={360}
                  className="aspect-square w-full rounded-xl object-cover"
                />
                <p className="mt-3 text-center text-sm font-medium text-foreground">
                  Dough Boi #{nft.id}
                </p>
              </CardContent>
            </Card>
          </div>
        ))}
      </Slider>
    </div>
  );
};

export default CardSlider;
