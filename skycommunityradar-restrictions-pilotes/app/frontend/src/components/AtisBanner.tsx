import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { ChevronDown, ChevronUp, Copy, Radio, Wind } from "lucide-react";
import { apiGet } from "@/lib/api";
import type { AtisInfo } from "@/lib/types";
import { cn } from "@/lib/utils";
import { tr } from "@/lib/i18n";

const OPEN_KEY = "sc.atis.open";
const pad3 = (n?: number) => String(Math.round(n ?? 0) % 360 || 360).padStart(3, "0");
const hasWeather = (i: AtisInfo) => !!(i.qnh || i.visibility_m || i.wind_speed_kt || i.wind_deg);
const visTxt = (m?: number) => ((m ?? 0) >= 9999 ? "10 km +" : `${Math.max(0, Math.round((m ?? 0) / 100) / 10)} km`);

/** Bandeau ATIS des aéroports contrôlés (positions ouvertes, ou positions fictives d'un instructeur).
 *  Données du serveur (/atc/atis) : METAR CheckWX + pistes AirportDB, lettre qui avance quand la météo change. */
export default function AtisBanner() {
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(OPEN_KEY) === "1";
    } catch {
      return false;
    }
  });
  const q = useQuery<AtisInfo[]>({
    queryKey: ["atc-atis-me"],
    queryFn: () => apiGet<AtisInfo[]>("/atc/atis"),
    refetchInterval: 60_000,
    retry: false,
  });
  const list = q.data ?? [];
  if (list.length === 0) return null; // aucune position ouverte : pas d'ATIS à afficher

  const toggle = () => {
    const v = !open;
    setOpen(v);
    try {
      localStorage.setItem(OPEN_KEY, v ? "1" : "0");
    } catch {
      /* mode privé : le choix dure le temps de la visite */
    }
  };
  const copy = async (i: AtisInfo) => {
    try {
      await navigator.clipboard.writeText(i.text ?? "");
      toast.success(tr("ATIS {0} copié", [i.icao]));
    } catch {
      toast.error(tr("Copie impossible sur ce navigateur"));
    }
  };

  return (
    <div className="shrink-0 border-b border-border bg-[color:var(--sc-topbar)]/90 text-xs backdrop-blur" data-testid="atis-banner">
      <div className="flex items-stretch gap-2 px-3 py-1.5">
        <div className="no-scrollbar flex min-w-0 flex-1 items-center gap-4 overflow-x-auto">
          {list.map((i) => (
            <div key={i.icao} className="flex shrink-0 items-center gap-2.5" data-testid={`atis-${i.icao}`}>
              <span className="flex items-center gap-1.5">
                <span className="font-mono text-sm font-bold tracking-[0.12em] text-foreground">{i.icao}</span>
                <span className="rounded bg-[color:var(--sc-primary)]/30 px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-200" title={tr("Lettre ATIS")} data-testid={`atis-letter-${i.icao}`}>
                  INFO {i.letter ?? "—"}
                </span>
              </span>
              {hasWeather(i) ? (
                <span className="flex items-center gap-2.5 font-mono text-[11px] text-muted-foreground">
                  <span className="flex items-center gap-1 text-foreground"><Wind className="h-3 w-3" />{pad3(i.wind_deg)}°/{i.wind_speed_kt ?? 0} kt</span>
                  <span>{tr("Vis")} {visTxt(i.visibility_m)}</span>
                  <span>QNH <b className="text-foreground">{i.qnh || "—"}</b></span>
                  {i.temp_c != null && <span>{i.temp_c}°C</span>}
                </span>
              ) : (
                <span className="text-[11px] text-amber-300" data-testid={`atis-nowx-${i.icao}`}>{tr("Météo indisponible")}</span>
              )}
              <span className="font-mono text-[11px] text-muted-foreground">
                {tr("DEP")} <b className="text-foreground">{i.runways_dep?.join("/") || "—"}</b> · {tr("ARR")} <b className="text-foreground">{i.runways_arr?.join("/") || "—"}</b>
              </span>
            </div>
          ))}
        </div>
        <button onClick={toggle} className="flex shrink-0 items-center gap-1 rounded-md border border-border px-2 text-[11px] font-semibold text-muted-foreground hover:text-foreground" aria-expanded={open} data-testid="atis-toggle">
          {tr("ATIS")} {open ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
        </button>
      </div>
      {open && (
        <div className="grid gap-2 border-t border-border/70 px-3 py-2 md:grid-cols-2 xl:grid-cols-3" data-testid="atis-details">
          {list.map((i) => (
            <section key={i.icao} className="space-y-1.5 rounded-lg border border-border bg-background/50 p-2.5">
              <header className="flex items-center justify-between gap-2">
                <span className="truncate font-semibold text-foreground">{i.name ?? i.icao}{i.elevation_ft != null ? ` · ${i.elevation_ft} ft` : ""}</span>
                <button onClick={() => copy(i)} className="shrink-0 rounded p-1 text-muted-foreground hover:bg-white/10 hover:text-foreground" title={tr("Copier l'ATIS")} data-testid={`atis-copy-${i.icao}`}>
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </header>
              <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-muted-foreground">{i.text}</pre>
              {i.raw && i.raw !== "N/A" && <p className="break-all font-mono text-[10px] text-muted-foreground/80">METAR {i.raw}</p>}
              {i.frequencies && Object.keys(i.frequencies).length > 0 && (
                <p className={cn("flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-[11px]")}>
                  <Radio className="h-3 w-3 text-muted-foreground" />
                  {Object.entries(i.frequencies).slice(0, 6).map(([k, v]) => (
                    <span key={k}>{k} <b className="text-amber-200">{v}</b></span>
                  ))}
                </p>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}