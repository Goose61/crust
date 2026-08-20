'use client'
import Image from 'next/image'
import { motion, useInView } from 'framer-motion'
import { useRef } from 'react'

const Work = () => {
  const ref = useRef(null)
  const inView = useInView(ref)

  const TopAnimation = {
    initial: { y: '-100%', opacity: 0 },
    animate: inView ? { y: 0, opacity: 1 } : { y: '-100%', opacity: 0 },
    transition: { duration: 0.6, delay: 0.4 },
  }

  const bottomAnimation = {
    initial: { y: '100%', opacity: 0 },
    animate: inView ? { y: 0, opacity: 1 } : { y: '100%', opacity: 0 },
    transition: { duration: 0.6, delay: 0.4 },
  }

  const services = [
    {
      icon: "/images/chooseus/chooseus-icon-1.svg",
      text: "Trait layers: folder names become traits, art generated automatically",
    },
    {
      icon: "/images/chooseus/chooseus-icon-2.svg",
      text: "SOL, USDC, or SPL at the same USD price with no meme-coin discount",
    },
    {
      icon: "/images/chooseus/chooseus-icon-3.svg",
      text: "Collections stay here after sell-out. No graduation.",
    },
    {
      icon: "/images/chooseus/chooseus-icon-1.svg",
      text: "Permanent on-chain storage + locked, immutable fee splits",
    },
    {
      icon: "/images/chooseus/chooseus-icon-2.svg",
      text: "Blind mint, reveal, gift mint, allowlist, waitlist",
    },
    {
      icon: "/images/chooseus/chooseus-icon-3.svg",
      text: "Milestones unlock holder lounge and native secondary",
    },
  ];

  return (
    <section className='' id='work'>
      <div className='container px-4 mx-auto lg:max-w-(--breakpoint-xl)'>
        <div ref={ref} className='grid grid-cols-12 items-center'>
          <motion.div
            {...bottomAnimation}
            className='lg:col-span-7 col-span-12'>
            <div className='flex flex-col gap-3'>
              <p className="font-medium text-foreground">
                Why this <span className="text-primary">marketplace</span>
              </p>
              <h2 className="text-3xl font-medium text-foreground sm:text-5xl md:w-70% lg:w-full">
                Advantages nobody else ships together
              </h2>
            </div>
            <div className='grid md:grid-cols-2 gap-7 mt-11'>
              {services.map((service, index) => (
                <div key={index} className='flex items-center gap-5'>
                  <div className='p-3 bg-primary/15 rounded-full'>
                    <Image
                      src={service.icon}
                      alt={`${service.text} icon`}
                      width={25}
                      height={25}
                    />
                  </div>
                  <p className='text-foreground font-medium'>{service.text}</p>
                </div>
              ))}
            </div>
          </motion.div>
          <motion.div {...TopAnimation} className='lg:col-span-5 col-span-12'>
            <div className='2xl:-mr-40 mt-9 flex justify-center'>
              <Image
                src='/images/dough/dough_katana.webp'
                alt='Dough Boi NFT'
                width={600}
                height={600}
                className='lg:w-full rounded-3xl object-contain'
              />
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

export default Work
