'use client'
import Image from 'next/image'
import { featuredGridNfts, portfolioData } from '@/app/api/data'
import { motion } from 'framer-motion'

const Portfolio = () => {
  return (
    <section className='pt-12' id='portfolio'>
      <div className='container px-4 sm:px-6'>
        <div className='grid lg:grid-cols-2 items-center gap-20'>
          <motion.div
            whileInView={{ y: 0, opacity: 1 }}
            initial={{ y: '-100%', opacity: 0 }}
            transition={{ duration: 0.6 }}
            className='grid grid-cols-2 gap-4'>
            {featuredGridNfts.map((src) => (
              <Image
                key={src}
                src={src}
                alt='Dough Boi NFT'
                width={360}
                height={360}
                className='aspect-square w-full rounded-2xl object-cover'
              />
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
              <h2 className="mb-4 text-3xl font-medium text-foreground sm:text-5xl">
                From first ZIP to secondary trade
              </h2>
            </div>
            <p className='text-lg text-white/70'>
              Creators get a compositor, rarity ranks, quotes, gift mint, and a native market.
              Collectors get one place to mint and resell. Dough Boi art is the visual language.
              Your collection is the proof it works.
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
                      <h3 className='text-muted text-xl ml-5'>
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
