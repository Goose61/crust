import Link from "next/link";

export default function NotFound() {
  return (
    <main className="container px-4 py-40 text-center">
      <p className="text-sm uppercase tracking-widest text-primary">404</p>
      <h1 className="mt-3 text-4xl font-medium text-white">Page not found</h1>
      <p className="mt-3 text-white/50">That route is not on this marketplace.</p>
      <Link href="/" className="mt-8 inline-block rounded-lg bg-primary px-5 py-2.5 text-white">
        Back to marketplace
      </Link>
    </main>
  );
}
