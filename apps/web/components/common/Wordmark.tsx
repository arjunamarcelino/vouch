import { cn } from "@vouch/ui/lib/utils";

/**
 * The Vouch wordmark (review 114): black ink on an opaque white PNG. Blend modes key the white bg out
 * against either theme (light → multiply keeps black ink; dark → invert+screen keeps white ink). Shared
 * so the header and app sidebar can't drift on those easy-to-miss blend classes. Height is overridable
 * via `className` (defaults to `h-7`); intrinsic w/h reserve the box to avoid first-paint reflow.
 */
export function Wordmark({ className }: { className?: string }) {
  return (
    <img
      src="/logos/vouch/vouch.png"
      alt="Vouch"
      width={828}
      height={285}
      className={cn("w-auto mix-blend-multiply dark:mix-blend-screen dark:invert", className ?? "h-7")}
    />
  );
}
