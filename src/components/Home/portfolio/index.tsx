'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { featuredGridNfts, portfolioData } from '@/app/api/data'
import { motion } from 'framer-motion'

type FeaturedItem = {
  tokenId: number
  name: string
  imageSrc: string
  href: string
}

const fallbackItems: FeaturedItem[] = featuredGridNfts.map((src, index) => {
  const id = Number(src.match(/(\d+)\.jpeg$/)?.[1] ?? index + 1)
  return {
    tokenId: id,
    name: `Dough Boi #${id}`,
    imageSrc: src,
    href: `/collection/dough-boi?token=${id}`,
  }
})

const Portfolio = () => {
  const [items, setItems] = useState<FeaturedItem[]>(fallbackItems)

  useEffect(() => {
    let cancelled = false
    void fetch('/api/featured-art')
      .then((r) => r.json())
      .then((data: { tokens?: FeaturedItem[] }) => {
        if (!cancelled && data.tokens && data.tokens.length > 0) {
          setItems(data.tokens.slice(0, 4))
        }
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <section className='pt-12' id='portfolio'>
      <div className='container px-4 sm:px-6'>
        <div className='grid items-center gap-10 lg:grid-cols-2 lg:gap-20'>
          <motion.div
            whileInView={{ y: 0, opacity: 1 }}
            initial={{ y: '-100%', opacity: 0 }}
            transition={{ duration: 0.6 }}
            className='grid grid-cols-2 gap-4'>
            {items.map((nft) => (
              <Link key={nft.tokenId} href={nft.href} className='block'>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={nft.imageSrc}
                  alt={nft.name}
                  width={360}
                  height={360}
                  className='aspect-square w-full rounded-2xl object-cover transition hover:brightness-110'
                />
              </Link>
            ))}
          </motion.div>

          <motion.div
            whileInView={{ y: 0, opacity: 1 }}
            initial={{ y: '100%', opacity: 0 }}
            transition={{ duration: 0.6 }}>
            <div className='flex flex-col gap-4'>
              <p className="font-medium text-foreground">
                Services on <span className="text-primary">this market</span>
              </p>
              <h2 className="mb-4 text-2xl font-medium text-foreground sm:text-5xl">
                From ZIP upload to secondary trade
              </h2>
            </div>
            <p className='text-lg text-white/70'>
              Creators upload finished art, confirm metadata, pay Arweave storage from their wallet,
              and go live. Collectors mint with SlicePay or SOL at a live USD quote. Dough Boi™ is
              the live collection on this market — tap a piece to open it.
            </p>

            <table className='w-full sm:w-[80%] mt-10'>
              <tbody>
                {portfolioData.map((item, index) => (
                  <tr key={index} className='border-b border-border'>
                    <td className='py-5'>
                      <div className='bg-primary/20 p-3 rounded-full w-fit'>
                        <Image
                          src={item.image}
                          alt={item.title}
                          width={24}
                          height={24}
                        />
                      </div>
                    </td>
                    <td className='py-5'>
                      <h3 className='text-white text-xl ml-5'>
                        {item.title}
                      </h3>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

export default Portfolio
