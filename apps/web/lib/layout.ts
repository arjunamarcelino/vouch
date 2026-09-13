/**
 * Shared page container for the app surface (review 114) — one source so the horizontal padding can't
 * drift. Previously `mx-auto max-w-[88rem] px-4 py-10 sm:px-6` was pasted across pages and some variants
 * dropped `sm:px-6`, misaligning loading/error states from loaded content on small screens.
 */
export const APP_CONTAINER = "mx-auto max-w-[88rem] px-4 py-10 sm:px-6";
