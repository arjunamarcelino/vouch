import { redirect } from "next/navigation";

/**
 * Root of the dApp deployment (app.withvouch.xyz). The marketing site now lives in a separate
 * deployment (`apps/landing`, withvouch.xyz), so `/` here just forwards into the gated app. The app's
 * own "home"/"demo" links point back out to the marketing site via `LANDING_URL`.
 */
export default function Page() {
  redirect("/app/dashboard");
}
