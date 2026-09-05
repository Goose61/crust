import type { Metadata } from "next";
import { Bricolage_Grotesque, Outfit, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";
import Header from "@/components/Layout/Header";
import Footer from "@/components/Layout/Footer";
import ScrollToTop from "@/components/ScrollToTop";
import Aoscompo from "@/utils/aos";
import { SolanaAdapterProvider } from "@/components/SolanaAdapterProvider";
import { WalletProvider } from "@/components/WalletProvider";

const display = Bricolage_Grotesque({
  subsets: ["latin"],
  variable: "--font-display",
  weight: ["700", "800"],
});

const body = Outfit({
  subsets: ["latin"],
  variable: "--font-body",
  weight: ["400", "500", "600"],
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-mono",
  weight: ["400", "500"],
});

export const metadata: Metadata = {
  title: "Dough Boi · NFT marketplace",
  description:
    "Launch NFT collections on Solana. Auto metadata, permanent storage, programmable fees, and in-ecosystem secondary trading.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${display.variable} ${body.variable} ${mono.variable} font-[family-name:var(--font-body)]`}>
        <SolanaAdapterProvider>
          <WalletProvider>
            <div className="flour" aria-hidden />
            <Header />
            <div className="relative z-[2]">
              <Aoscompo>
                {children}
                <Footer />
              </Aoscompo>
            </div>
            <ScrollToTop />
          </WalletProvider>
        </SolanaAdapterProvider>
      </body>
    </html>
  );
}
