import { createAuthenticationAdapter } from "@rainbow-me/rainbowkit";
import { createSiweMessage } from "viem/siwe";
import { parseOrThrow, nonceSchema } from "@vouch/shared/schemas";
import { API_BASE_URL } from "./env";

/**
 * RainbowKit SIWE adapter wired to our OWN cookie backend (NOT next-auth). The four callbacks hit
 * `/auth/nonce`, build the message with viem's `createSiweMessage`, `/auth/verify` (sets the
 * httpOnly+Strict session cookie), and `/auth/logout`. Every fetch sends `credentials: "include"` or
 * the cookie round-trip silently fails and status never flips to authenticated. We call `/auth/verify`
 * WITHOUT `?bearer=1` and never read/store a token — the session is the cookie only (security P0.1).
 *
 * `onAuthChange` lets the provider invalidate the `/auth/me` query after verify/sign-out so the
 * app's auth status (and role-gating) re-derives from the server, not from optimistic client state.
 */
function apiUrl(path: string): string {
  return `${API_BASE_URL.replace(/\/$/u, "")}${path}`;
}

export function makeAuthAdapter(
  onAuthChange: () => void,
): ReturnType<typeof createAuthenticationAdapter<string>> {
  return createAuthenticationAdapter({
    getNonce: async () => {
      const res = await fetch(apiUrl("/auth/nonce"), { method: "POST", credentials: "include" });
      if (!res.ok) throw new Error(`nonce failed: ${res.status}`);
      return parseOrThrow(nonceSchema, await res.json(), "nonce").nonce;
    },

    createMessage: ({ nonce, address, chainId }) =>
      createSiweMessage({
        domain: window.location.host,
        address,
        statement: "Sign in to Vouch — confidential outcome assurance.",
        uri: window.location.origin,
        version: "1",
        chainId,
        nonce,
      }),

    verify: async ({ message, signature }) => {
      const res = await fetch(apiUrl("/auth/verify"), {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message, signature }),
      });
      if (res.ok) onAuthChange();
      return res.ok;
    },

    signOut: async () => {
      await fetch(apiUrl("/auth/logout"), { method: "POST", credentials: "include" });
      onAuthChange();
    },
  });
}
