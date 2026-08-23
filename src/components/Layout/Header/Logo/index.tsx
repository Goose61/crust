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
      <span className="flex min-w-0 flex-col leading-none">
        <span className="truncate font-bold text-base text-white tracking-tight sm:text-[1.1rem]">
          Dough Boi
        </span>
        <span className="hidden font-[family-name:var(--font-body)] text-[11px] tracking-[0.08em] text-white/50 sm:block">
          NFT marketplace
        </span>
      </span>
    </Link>
  );
};

export default Logo;
