import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * Merge conditional class names and resolve Tailwind utility conflicts.
 * Standard shadcn/ui `cn` helper: clsx builds the class list, tailwind-merge
 * de-duplicates conflicting Tailwind classes (last one wins).
 */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
