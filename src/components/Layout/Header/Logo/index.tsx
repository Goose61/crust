import Image from "next/image";
import Link from "next/link";

const Logo: React.FC = () => {
  return (
    <Link href="/" className="flex items-center gap-2.5 text-white">
      <Image
        src="/images/dough/main_logo.webp"
        alt="Dough Boi"
        width={36}
        height={36}
        className="h-9 w-9 rounded-full object-cover"
      />
      <span className="flex flex-col leading-none">
        <span className="font-bold text-[1.1rem] text-white tracking-tight">
          Dough Boi™
        </span>
        <span className="font-[family-name:var(--font-body)] text-[11px] tracking-[0.08em] text-white/50">
          NFT marketplace
        </span>
      </span>
    </Link>
  );
};

export default Logo;
