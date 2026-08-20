import { redirect } from "next/navigation";

/**
 * The landing page (/) is served as a static HTML rewrite to /thecrust/index.html.
 * This React page is only reached if the rewrite is not matched (e.g. middleware short-circuit).
 * In that case, bounce the user to /marketplace.
 */
export default function RootPage() {
  redirect("/marketplace");
}
