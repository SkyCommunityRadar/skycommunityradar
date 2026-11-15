import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AnimatePresence, motion } from "motion/react";
import { PanelRightClose, PanelRightOpen } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import AppShell, { type UiMode, useIsFormation } from "@/components/AppShell";
import RadarMap, { type MapView } from "@/components/RadarMap";
import FlightList from "@/components/FlightList";
import FlightPanel from "@/components/FlightPanel";
import StripBoard from "@/components/StripBoard";
import AtcPositionPanel, { useAtcPositions } from "@/components/AtcPositionPanel";
import TrainingPanel from "@/components/TrainingPanel";
import { Button } from "@/components/ui/button";
import { errMsg, useFlight, useFlights, useGround, useNearbyGrounds } from "@/lib/hooks";
import type { AirportRef, AirspaceResponse, User } from "@/lib/types";
import { apiGet } from "@/lib/api";
import { cn } from "@/lib/utils";
import { useFlightEditing } from "@/lib/useFlightEditing";

import { tr } from "@/lib/i18n";
type Tab = "vol" | "vols" | "strips" | "atc";
type Sheet = "min" | "half" | "tall";

/** Phone / tablet: the panel is a sheet at the bottom of the radar, resized by dragging its handle. */
const SHEET_H: Record<Sheet, string> = { min: "5.75rem", half: "50%", tall: "calc(100% - 17dvh)" };
const SHEET_MIN_PX = 92;

function useIsDesktop(): boolean {
  const q = "(min-width: 1024px)";
  const [on, setOn] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const h = () => setOn(m.matches);
    m.addEventListener("change", h);
    return () => m.removeEventListener("change", h);
  }, []);
  return on;
}

function RadarView({ user, mode }: { user: User; mode: UiMode }) {
  const isAtc = mode === "atc";
  const isFormation = useIsFormation(user);
  const [panelOpen, setPanelOpen] = useState(true); // computer: the side panel can be hidden
  const desktop = useIsDesktop();
  const [sheet, setSheet] = useState<Sheet>("half"); // phone: height of the bottom panel
  const [dragH, setDragH] = useState<number | null>(null);
  const drag = useRef<{ y: number; h: number; moved: boolean } | null>(null);
  const asideRef = useRef<HTMLElement | null>(null);
  const sheetSnaps = (): [Sheet, number][] => {
    const parent = asideRef.current?.parentElement?.getBoundingClientRect().height ?? window.innerHeight;
    return [["min", SHEET_MIN_PX], ["half", parent * 0.5], ["tall", parent - window.innerHeight * 0.17]];
  };
  const [params, setParams] = useSearchParams();
  const selectedId = params.get("f");
  // a flight given in the address (or clicked on the map) opens its panel directly
  const [tab, setTab] = useState<Tab>(selectedId ? "vol" : isAtc ? "strips" : "vols");
  // every layer is always on for everyone (no toggles)
  const show = { ground: true, fir: true, tracon: true, atc: true };
  const [view, setView] = useState<MapView | null>(null);
  // sectors are fetched for a 5°-aligned box: panning inside it reuses the same data (no refetch, no redraw)
  const Q = 5;
  const bboxKey = view
    ? view.bbox.map((v, i) => Math.max(i % 2 ? -180 : -90, Math.min(i % 2 ? 180 : 90, (i < 2 ? Math.floor(v / Q) : Math.ceil(v / Q)) * Q))).join(",")
    : null;
  const firQ = useQuery<AirspaceResponse>({
    queryKey: ["airspaces", "fir", bboxKey],
    queryFn: () => apiGet<AirspaceResponse>(`/airspaces?kind=fir&bbox=${bboxKey}`),
    enabled: !!bboxKey && show.fir && (view?.zoom ?? 0) >= 3 && (view?.zoom ?? 0) <= 10,
    staleTime: 10 * 60_000,
    placeholderData: (prev) => prev,
  });
  const traconQ = useQuery<AirspaceResponse>({
    queryKey: ["airspaces", "tracon", bboxKey],
    queryFn: () => apiGet<AirspaceResponse>(`/airspaces?kind=tracon&bbox=${bboxKey}`),
    enabled: !!bboxKey && show.tracon && (view?.zoom ?? 0) >= 6 && (view?.zoom ?? 0) <= 12,
    staleTime: 10 * 60_000,
    placeholderData: (prev) => prev,
  });
  const atcQ = useAtcPositions();
  const flights = useFlights("active");
  const sel = useFlight(selectedId);
  const [focus, setFocus] = useState<{ c: [number, number]; z: number; k: string } | null>(null);
  const [apSearch, setApSearch] = useState("");

  // selecting never moves the map: centring is a manual action ("Centrer sur l'avion")
  const select = (id: string | null) => {
    setParams(id ? { f: id } : {}, { replace: true });
    if (id) {
      setTab("vol");
      setPanelOpen(true);
      setSheet((s) => (s === "min" ? "half" : s));
    } else if (tab === "vol") setTab(isAtc ? "strips" : "vols");
  };
  const list = flights.data?.flights ?? [];
  const selected = sel.data && sel.data.id === selectedId ? sel.data : null;
  const depGround = useGround(selected?.departure);
  const arrGround = useGround(selected?.arrival);
  const ed = useFlightEditing(selected, depGround.data, "view", undefined, arrGround.data);
  // entering a taxi route / picking a holding point centres the map on the stand
  useEffect(() => {
    if (ed.focusAt) setFocus({ c: ed.focusAt, z: 16, k: ed.focusKey });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ed.focusKey]);
  const [apFoundIcao, setApFoundIcao] = useState<string | null>(null);
  const apGround = useGround(apFoundIcao);
  const center: [number, number] | null = view ? [(view.bbox[0] + view.bbox[2]) / 2, (view.bbox[1] + view.bbox[3]) / 2] : null;
  const nearby = useNearbyGrounds(center, view?.zoom ?? 0);
  const grounds = [depGround.data, arrGround.data, apGround.data, ...nearby.grounds]
    .filter((g, i, arr) => !!g && arr.findIndex((x) => x?.icao === g.icao) === i)
    .map((g) => g!);

  const [apFound, setApFound] = useState<AirportRef | null>(null);
  const [apError, setApError] = useState<string | null>(null);
  const searchAirport = async () => {
    const code = apSearch.trim().toUpperCase();
    setApError(null);
    if (!/^[A-Z0-9]{4}$/.test(code)) {
      setApError(tr("Code OACI sur 4 caractères (ex. LFPG)."));
      return;
    }
    try {
      const ap = await apiGet<AirportRef>(`/airports/lookup/${code}`);
      setApFound(ap);
      setApFoundIcao(ap.icao);
      setFocus({ c: [ap.lat, ap.lon], z: 14, k: `ap-${ap.icao}-${Date.now()}` });
      window.setTimeout(() => {
        setApFound((cur) => (cur && cur.icao === ap.icao ? null : cur));
        setApFoundIcao((cur) => (cur === ap.icao ? null : cur));
      }, 30_000);
    } catch (e) {
      setApFound(null);
      setApError(errMsg(e));
    }
  };

  const tabs: { k: Tab; label: string }[] = [
    ...(selected ? [{ k: "vol" as const, label: selected.callsign }] : []),
    ...(isAtc ? [{ k: "strips" as const, label: tr("Strips") }] : []),
    { k: "vols", label: tr("Vols actifs ({0})", [list.length]) },
    { k: "atc", label: tr("Fréquences ({0})", [atcQ.data?.length ?? 0]) },
  ];
  const activeTab = tab === "vol" && !selected ? (isAtc ? "strips" : "vols") : tab;

  return (
    <div className="flex h-full flex-col lg:flex-row">
      <section className="relative min-h-[16dvh] flex-1 bg-radar">
        <RadarMap
          flights={list}
          selectedId={selectedId}
          onSelect={(id) => select(id)}
          route={selected?.route}
          flownIndex={selected?.position.track === "air" ? selected.position.wp_index : undefined}
          aircraftPos={selected?.position.track === "air" && !selected.vector ? (selected.holding?.entered ? (selected.holding.path[0] as [number, number]) : [selected.position.lat, selected.position.lon]) : undefined}
          vectors={list.filter((fl) => (fl.id === selected?.id ? selected.vector : fl.vector)).map((fl) => {
            const v = (fl.id === selected?.id ? selected!.vector : fl.vector)!;
            return { id: fl.id, path: v.path, label: v.label, selected: fl.id === selectedId };
          })}
          holdPath={selected?.holding?.path}
          lineupPath={selected?.lineup ?? undefined}
          firs={show.fir && (view?.zoom ?? 0) <= 10 ? firQ.data?.features : undefined}
          tracons={show.tracon && (view?.zoom ?? 0) >= 6 && (view?.zoom ?? 0) <= 12 ? traconQ.data?.features : undefined}
          atc={show.atc ? atcQ.data : undefined}
          showGround={show.ground}
          onViewChange={setView}
          taxis={selected ? ed.taxis : []}
          grounds={grounds}
          highlightGates={ed.gateHighlight ?? (selected ? [selected.dep_gate?.ref, selected.arr_gate?.ref].filter((r): r is string => !!r) : undefined)}
          draftPoints={ed.draftPoints}
          onMapClick={ed.onMapClick}
          onHoldingClick={ed.onHoldingClick}
          onTaxiwayClick={ed.onTaxiwayClick}
          onGateClick={ed.onGateClick}
          selectedHolding={ed.editingKind === "taxi_out" || ed.mode === "reject_hold" ? ed.destination : selected?.holding_point}
          crosshair={ed.crosshair}
          pushHint={ed.pushHint}
          center={focus?.c}
          zoom={focus?.z}
          focusKey={focus?.k}
        />
        <button
          className="absolute right-3 top-3 z-[600] hidden h-10 items-center gap-1.5 rounded-lg lg:flex border border-border bg-background/90 px-3 text-sm text-muted-foreground backdrop-blur transition-colors duration-150 hover:bg-secondary hover:text-[color:var(--sc-accent)]"
          onClick={() => setPanelOpen((o) => !o)}
          title={panelOpen ? tr("Masquer le panneau") : tr("Afficher le panneau")}
          data-testid="toggle-right-panel"
        >
          {panelOpen ? <PanelRightClose className="h-4 w-4" /> : <PanelRightOpen className="h-4 w-4" />}
          <span className="hidden lg:inline">{panelOpen ? tr("Masquer") : tr("Panneau")}</span>
        </button>
        {(firQ.isError || traconQ.isError) && (
          <p className="absolute right-3 top-16 z-[600] rounded-lg border border-red-500/40 bg-background/90 px-2.5 py-1.5 text-xs text-red-300" data-testid="airspace-error">{tr("Espaces aériens indisponibles.")}</p>
        )}
        <div className="absolute left-14 top-3 z-[500] flex gap-1.5 rounded-lg border border-border bg-background/90 p-1.5 backdrop-blur">
          <input
            value={apSearch}
            onChange={(e) => setApSearch(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === "Enter" && searchAirport()}
            placeholder={tr("Aéroport OACI")}
            maxLength={4}
            className="w-32 bg-transparent px-2 font-mono text-sm uppercase outline-none"
            data-testid="map-airport-search-input"
          />
          <Button size="sm" variant="secondary" onClick={searchAirport} data-testid="map-airport-search-button">{tr("Aller")}</Button>
        </div>
        {selected && ed.banner && (
          <div className="absolute left-1/2 top-16 z-[600] -translate-x-1/2 rounded-lg border border-[color:var(--sc-accent)]/50 bg-background/90 px-3 py-1.5 text-xs text-[color:var(--sc-accent-soft)] backdrop-blur" data-testid="map-mode-banner">
            {ed.banner}
          </div>
        )}
        {nearby.loading.length > 0 && (
          <div className="absolute bottom-6 left-1/2 z-[500] -translate-x-1/2 rounded-lg border border-[color:var(--sc-accent)]/40 bg-background/90 px-3 py-1.5 text-xs text-[color:var(--sc-accent-soft)] backdrop-blur" data-testid="ground-loading">{tr("Chargement du plan de {0} (OpenStreetMap)…", [nearby.loading.join(", ")])}</div>
        )}
        {(apFound || apError) && (
          <div
            className={`absolute left-14 top-16 z-[500] max-w-xs rounded-lg border bg-background/90 px-3 py-2 text-xs backdrop-blur ${apError ? "border-red-500/50 text-red-300" : "border-border text-foreground"}`}
            data-testid="map-airport-search-result"
          >
            {apError ?? (
              <>
                <span className="font-mono font-semibold text-[color:var(--sc-accent)]">{apFound!.icao}</span> {apFound!.name}
              </>
            )}
          </div>
        )}
      </section>
      <AnimatePresence initial={false}>
        {(panelOpen || !desktop) && (
          <motion.aside
            key="panel"
            ref={asideRef}
            style={desktop ? undefined : { height: dragH ?? SHEET_H[sheet] }}
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: "auto", opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.22, ease: [0.4, 0, 0.2, 1] }}
            className={cn(
              "flex shrink-0 flex-col overflow-hidden border-t border-border bg-card lg:border-l lg:border-t-0",
              !desktop && dragH === null && "transition-[height] duration-300 ease-out",
            )}
            data-testid="radar-right-panel"
          >
            <div className="theme-stripe" aria-hidden />
            {/* drag the handle up or down (or tap it) to resize the panel over the map */}
            <div
              role="button"
              tabIndex={0}
              className="flex h-8 w-full shrink-0 cursor-grab touch-none select-none items-center justify-center active:cursor-grabbing lg:hidden"
              aria-label={tr("Faire glisser pour agrandir ou réduire le panneau")}
              onPointerDown={(e) => {
                const el = asideRef.current;
                if (!el) return;
                e.currentTarget.setPointerCapture(e.pointerId);
                drag.current = { y: e.clientY, h: el.getBoundingClientRect().height, moved: false };
              }}
              onPointerMove={(e) => {
                const d = drag.current;
                if (!d) return;
                if (Math.abs(d.y - e.clientY) > 6) d.moved = true;
                if (d.moved) setDragH(Math.max(SHEET_MIN_PX, Math.min(sheetSnaps()[2][1], d.h + d.y - e.clientY)));
              }}
              onPointerUp={(e) => {
                const d = drag.current;
                drag.current = null;
                if (!d) return;
                if (!d.moved) setSheet((s) => (s === "half" ? "tall" : "half"));
                else {
                  const h = d.h + d.y - e.clientY;
                  setSheet(sheetSnaps().reduce((a, b) => (Math.abs(b[1] - h) < Math.abs(a[1] - h) ? b : a))[0]);
                }
                setDragH(null);
              }}
              onPointerCancel={() => { drag.current = null; setDragH(null); }}
              onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && setSheet((s) => (s === "half" ? "tall" : "half"))}
              data-testid="radar-panel-resize"
            >
              <span className="h-1.5 w-12 rounded-full bg-muted-foreground/45" />
            </div>
            <div className="no-scrollbar flex w-full shrink-0 overflow-x-auto border-b border-border lg:w-[26rem]" role="tablist">
              {tabs.map(({ k, label }) => (
                <button
                  key={k}
                  role="tab"
                  aria-selected={activeTab === k}
                  onClick={() => { setTab(k); setSheet((s) => (s === "min" ? "half" : s)); }}
                  className={cn(
                    "flex-1 whitespace-nowrap border-b-2 px-2.5 py-2.5 text-[13px] font-medium transition-[color,border-color] duration-150 sm:px-3 sm:py-3 sm:text-sm",
                    activeTab === k ? "border-[color:var(--sc-accent)] text-[color:var(--sc-accent)]" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                  data-testid={`radar-tab-${k}`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="min-h-0 w-full flex-1 overflow-y-auto lg:w-[26rem]">
              <AnimatePresence mode="wait">
                <motion.div key={activeTab + (activeTab === "vol" ? selected?.id ?? "" : "")} initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }} className="h-full">
                  {activeTab === "vol" && selected ? (
                    <FlightPanel
                      flight={selected}
                      ed={ed}
                      onClose={() => select(null)}
                      onCenter={() => setFocus({ c: [selected.position.lat, selected.position.lon], z: selected.position.on_ground ? 15 : 8, k: `fl-${Date.now()}` })}
                    />
                  ) : activeTab === "strips" && isAtc ? (
                    <StripBoard selectedId={selectedId} onSelect={(id) => select(id)} myAirport={atcQ.data?.find((p) => p.controller === user.display_name)?.airport ?? null} />
                  ) : activeTab === "atc" ? (
                    <div className="space-y-5 p-4">
                      {isFormation && <TrainingPanel />}
                      <AtcPositionPanel user={user} canOpen={isAtc && !isFormation} />
                    </div>
                  ) : (
                    <FlightList flights={list} selectedId={selectedId} onSelect={(id) => select(id)} loading={flights.isLoading} error={flights.isError} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.aside>
        )}
      </AnimatePresence>
    </div>
  );
}

function RadarWithFormation({ user, mode }: { user: User; mode: UiMode }) {
  const isFormation = useIsFormation(user);
  return <RadarView key={`${mode}-${isFormation ? "f" : "n"}`} user={user} mode={mode} />;
}

export default function Radar() {
  return <AppShell>{(u, mode) => <RadarWithFormation user={u} mode={mode} />}</AppShell>;
}