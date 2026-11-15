import { tr } from "@/lib/i18n";

/** Same text as the server (lib/conflicts.py PHONE_ATC_MSG). */
export const PHONE_ATC_MSG = "Le contrôle ATC se fait sur ordinateur ou tablette : il n'est pas disponible sur téléphone.";
export const phoneAtcMsg = () => tr(PHONE_ATC_MSG);

/** A phone (not a tablet): « Mobile » browser, or a small touch screen (iPhone set to « site pour ordinateur »).
 * ATC control is not available on it; tablets and computers are. */
export function isPhone(): boolean {
  if (typeof window === "undefined") return false;
  const ua = navigator.userAgent;
  if (/iPad/i.test(ua)) return false;
  if (/iPhone|iPod|Windows Phone|Mobi/i.test(ua)) return true;
  const coarse = window.matchMedia?.("(pointer: coarse)").matches;
  return !!coarse && Math.min(window.screen.width, window.screen.height) < 600;
}
