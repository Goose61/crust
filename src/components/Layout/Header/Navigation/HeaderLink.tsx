"use client";
import Link from "next/link";
import { HeaderItem } from "../../../../types/menu";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

const HeaderLink: React.FC<{
  item: HeaderItem;
  activeHash: string;
  setActiveHash: (hash: string) => void;
}> = ({ item, activeHash, setActiveHash }) => {
  const [submenuOpen, setSubmenuOpen] = useState(false);
  const path = usePathname();
  const handleMouseEnter = () => {
    if (item.submenu) {
      setSubmenuOpen(true);
    }
  };
  const handleMouseLeave = () => {
    setSubmenuOpen(false);
  };

  useEffect(() => {
    setActiveHash(window.location.hash);
  }, [path, setActiveHash]);

  const handleLinkClick = (href: string) => {
    if (href.includes("#")) {
      const hash = "#" + href.split("#")[1];
      setActiveHash(hash);
    } else {
      setActiveHash("");
    }
  };

  const isActive = (href: string) => {
    if (href.includes("#")) {
      const [hrefPath, hrefHash] = href.split("#");
      return path === hrefPath && activeHash === `#${hrefHash}`;
    }
    return path === href;
  };

  return (
    <div
      className="relative"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <Link
        href={item.href}
        onClick={() => handleLinkClick(item.href)}
        className={`relative flex font-[family-name:var(--font-body)] text-[0.92rem] font-medium capitalize transition-all duration-300 hover:text-primary ${
          isActive(item.href) ? "text-primary" : "text-[var(--header-fg)]"
        }`}
      >
        {item.label}
        {item.submenu && (
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="1.5em"
            height="1.5em"
            viewBox="0 0 24 24"
          >
            <path
              fill="none"
              stroke="currentColor"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth="1.5"
              d="m7 10l5 5l5-5"
            />
          </svg>
        )}
      </Link>
      {submenuOpen && (
        <div
          className={`absolute py-2 left-0 mt-0.5 w-60 bg-white dark:text-white shadow-lg rounded-lg `}
          data-aos="fade-up"
          data-aos-duration="500"
        >
          {item.submenu?.map((subItem, index) => (
            <Link
              key={index}
              href={subItem.href}
              className={`block px-4 py-2 transition-all duration-300 ${
                isActive(subItem.href)
                  ? "bg-primary/10 text-primary"
                  : "text-black dark:text-white hover:bg-primary/10 hover:text-primary"
              }`}
            >
              {subItem.label}
            </Link>
          ))}
        </div>
      )}
    </div>
  );
};

export default HeaderLink;
