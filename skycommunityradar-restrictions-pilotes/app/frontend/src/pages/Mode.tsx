import { useState } from "react";
import LangSwitch from "@/components/LangSwitch";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plane, RadioTower, Lock, Moon, GraduationCap } from "lucide-react";
import { apiPost, getModeLock } from "@/lib/api";
import { errMsg, useMe } from "@/lib/hooks";
import { endSession } from "@/lib/session";
import type { InactivityStatus, User } from "@/lib/types";
import { cn } from "@/lib/utils";
import { isPhone, PHONE_ATC_MSG, phoneAtcMsg } from "@/lib/device";

import { locale, tr, trServer } from "@/lib/i18n";
const ADMIN_MODE_KEY = "sc.admin.uimode";
type AM = "pilote" | "atc"; // modes soumis à la règle d'inactivité
type M = AM | "instructeur" | "formation_pilote"; // formation = profils d'entraînement (instructeurs + admins)

const fmtDay = (iso: string) => new Date(iso).toLocaleDateString(locale(), { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" });

/** Suspended for inactivity: explanation + « Demander la réactivation » (sent to the responsables). */
function Suspended({ mode, st, onSent }: { mode: AM; st: InactivityStatus; onSent: (u: User) => void }) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const lead = mode === "atc" ? "Responsable ATC" : "Responsable Pilotes";
  const send = async () => {
    setBusy(true);
    try {
      await apiPost(`/activity/me/${mode}/request`, msg.trim() ? { message: msg.trim() } : {});
      toast.success(tr("Demande envoyée au {0}", [lead]));
      await qc.invalidateQueries({ queryKey: ["me"] });
      const u = qc.getQueryData<User>(["me"]);
      if (u) onSent(u);
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-3 space-y-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs" data-testid={`mode-${mode}-suspended`}>
      <p className="font-semibold text-amber-200">{tr("Accès suspendu pour inactivité")}</p>
      <p className="text-amber-100/90">{trServer(st.reason ?? "")}</p>
      {st.request_at ? (
        <p className="text-emerald-300" data-testid={`mode-${mode}-request-sent`}>{tr("Demande de réactivation envoyée le {0} : le {1} va la traiter.", [fmtDay(st.request_at), lead])}</p>
      ) : (
        <>
          <input
            value={msg}
            onChange={(e) => setMsg(e.target.value)}
            maxLength={300}
            placeholder={tr("Un petit mot pour le responsable (facultatif)")}
            className="w-full rounded border border-border bg-background/70 px-2 py-1.5 text-xs outline-none focus:border-[color:var(--sc-accent)]"
            data-testid={`mode-${mode}-request-message`}
          />
          <button
            onClick={send}
            disabled={busy}
            className="rounded-md bg-amber-500 px-3 py-1.5 font-semibold text-black transition-colors hover:bg-amber-400 disabled:opacity-60"
            data-testid={`mode-${mode}-request`}
          >
            {busy ? tr("Envoi…") : tr("Demander la réactivation")}
          </button>
        </>
      )}
    </div>
  );
}

/** After login: choose Pilote or ATC. A mode the member has no Discord role for stays visible but locked,
 * and a mode suspended for inactivity explains why and lets the member ask for its reactivation. */
export default function Mode() {
  const me = useMe();
  const qc = useQueryClient();
  const nav = useNavigate();
  const loc = useLocation();
  const [busy, setBusy] = useState<string | null>(null);
  const from = (loc.state as { from?: string } | null)?.from;
  // vol actif -> pas d'ATC ; position ATC ouverte -> pas de Pilote (règle appliquée aussi côté serveur)
  const lockQ = useQuery({ queryKey: ["mode-lock"], queryFn: getModeLock, enabled: !!me.data, staleTime: 0 });
  const target = from && from !== "/mode" ? from : "/";

  if (me.isError) return <Navigate to="/login" replace />;
  if (!me.data) return <div className="p-8 font-mono text-sm text-muted-foreground">{tr("Chargement…")}</div>;
  const u = me.data;
  const isAdmin = u.access.admin || u.role === "admin";
  const canTrain = isAdmin || u.access.instructor;
  const phone = isPhone();

  async function choose(mode: M) {
    if (mode !== "pilote" && mode !== "formation_pilote" && isPhone()) {
      toast.error(phoneAtcMsg());
      return;
    }
    try {
      // formation modes are never mode-locked; normal pilote/atc still are
      const reason = mode === "instructeur" || mode === "formation_pilote" ? null : (await getModeLock())[mode as AM];
      if (reason) {
        toast.error(trServer(reason));
        return;
      }
    } catch {
      /* le serveur refusera de toute façon si le mode est verrouillé */
    }
    setBusy(mode);
    try {
      // Admin + formation : vrai changement de rôle côté serveur (plus de perms admin en formation)
      // Admin + pilote/atc : session formation effacée, retour admin + préférence d'affichage locale
      const user = await apiPost<User>("/auth/mode", { mode });
      if (isAdmin && (mode === "pilote" || mode === "atc")) {
        localStorage.setItem(ADMIN_MODE_KEY, mode);
        window.dispatchEvent(new Event("sc-mode"));
      }
      if (mode === "instructeur" || mode === "formation_pilote") {
        localStorage.removeItem(ADMIN_MODE_KEY);
      }
      qc.clear();
      qc.setQueryData(["me"], user);
      const msg =
        mode === "atc" ? tr("Mode ATC activé")
        : mode === "instructeur" ? tr("Mode formation ATC activé")
        : mode === "formation_pilote" ? tr("Mode formation Pilote activé")
        : tr("Mode Pilote activé");
      toast.success(msg);
      nav(target, { replace: true });
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setBusy(null);
    }
  }

  const cards: { mode: M; title: string; icon: typeof Plane; text: string }[] = [
    {
      mode: "pilote" as const,
      title: tr("Pilote"),
      icon: Plane,
      text: tr("Volez sur le réseau SkyCommunity : déposez votre plan de vol SimBrief, suivez votre avion sur le radar et soyez guidé par les contrôleurs."),
    },
    {
      mode: "atc" as const,
      title: "ATC",
      icon: RadioTower,
      text: tr("Contrôlez le trafic : ouvrez votre position (sol, tour, approche ou centre) et gérez les vols de votre zone en direct sur le radar."),
    },
    // profils de formation : instructeurs Discord + admins
    ...(canTrain
      ? [
          {
            mode: "instructeur" as const,
            title: tr("Formation ATC"),
            icon: GraduationCap,
            text: tr("Profil fictif pour former les contrôleurs : positions d'entraînement et ATIS, sans aucune ouverture sur Discord ni impact sur le trafic réel. Aucun droit admin."),
          },
          {
            mode: "formation_pilote" as const,
            title: tr("Formation Pilote"),
            icon: Plane,
            text: tr("Entraînement côté pilote : mêmes outils qu'un pilote (plan de vol, radar), sans droits admin ni impact formation ATC."),
          },
        ]
      : []),
  ];

  return (
    <div className="relative flex min-h-dvh items-center justify-center bg-[radial-gradient(circle_at_30%_20%,var(--sc-glow)_0%,var(--sc-topbar)_55%)] p-6">
      <LangSwitch className="absolute right-4 top-4" />
      <div className={cn("w-full space-y-8", cards.length >= 4 ? "max-w-2xl" : "max-w-3xl")}>
        <div className="flex items-center gap-3">
          <img src="/logo.png" alt={tr("SkyCommunity")} className="h-12 w-12 shrink-0 rounded-full bg-white ring-2 ring-[color:var(--sc-accent)]/40" />
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" data-testid="mode-title">{tr("Bonjour {0}, quel poste aujourd'hui ?", [u.display_name])}</h1>
            <p className="text-sm text-muted-foreground">{tr("Vous pourrez changer de mode à tout moment depuis l'en-tête.")}</p>
          </div>
        </div>
        <div className={cn("grid gap-5", cards.length >= 4 ? "sm:grid-cols-2" : cards.length > 2 ? "md:grid-cols-3" : "md:grid-cols-2")}>
          {cards.map(({ mode, title, icon: Icon, text }) => {
            const isFormation = mode === "instructeur" || mode === "formation_pilote";
            const noRole = isFormation
              ? !canTrain
              : !isAdmin && !u.access[mode as AM];
            const st = isFormation ? undefined : u.inactivity?.[mode as AM];
            const suspended = !isAdmin && !noRole && st?.state === "suspendu";
            const phoneLock = mode !== "pilote" && mode !== "formation_pilote" && phone ? PHONE_ATC_MSG : null;
            const busyReason = !noRole && !suspended ? phoneLock ?? (isFormation ? null : lockQ.data?.[mode as AM]) ?? null : null;
            const locked = noRole || suspended || !!busyReason;
            return (
              <div
                key={mode}
                role={locked ? undefined : "button"}
                tabIndex={locked ? -1 : 0}
                onClick={() => !locked && !busy && choose(mode)}
                onKeyDown={(e) => !locked && !busy && (e.key === "Enter" || e.key === " ") && choose(mode)}
                aria-disabled={locked}
                data-testid={`mode-${mode}-button`}
                className={cn(
                  "group relative overflow-hidden rounded-xl border p-6 text-left transition-[transform,border-color,box-shadow] duration-200",
                  cards.length >= 4 && "sm:aspect-square", // 4 cartes : grille 2×2, cartes carrées (grandissent si un encart s'affiche)
                  locked
                    ? "cursor-not-allowed border-border bg-card/60"
                    : "cursor-pointer border-[color:var(--sc-primary)]/50 bg-card hover:-translate-y-1 hover:border-[color:var(--sc-accent)] hover:shadow-[0_12px_40px_-12px_var(--sc-primary)]",
                )}
              >
                <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-[color:var(--sc-primary)]/15 blur-2xl" />
                <div className={cn(locked && "opacity-55")}>
                  <Icon className="h-9 w-9 text-[color:var(--sc-accent)]" />
                  <div className="mt-4 flex items-center gap-2 text-xl font-semibold">
                    {title} {noRole && <Lock className="h-4 w-4 text-muted-foreground" />}
                    {suspended && <Moon className="h-4 w-4 text-amber-300" />}
                    {busyReason && <Lock className="h-4 w-4 text-amber-300" />}
                  </div>
                  <p className="mt-1.5 text-sm text-muted-foreground">{text}</p>
                </div>
                {noRole && (
                  <div className="mt-3 rounded-lg border border-border bg-background/50 p-3 text-xs" data-testid={`mode-${mode}-locked`}>
                    <p className="font-semibold text-foreground">{tr("Vous n'avez pas accès au mode {0}.", [title])}</p>
                    <p className="mt-0.5 text-muted-foreground">{tr("Il faut le rôle {0} sur le serveur Discord SkyCommunity.", [title])}</p>
                  </div>
                )}
                {busyReason && (
                  <div className="mt-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-xs" data-testid={`mode-${mode}-busy`}>
                    <p className="text-amber-100/90">{trServer(busyReason)}</p>
                  </div>
                )}
                {suspended && st && !isFormation && <Suspended mode={mode as AM} st={st} onSent={(nu) => qc.setQueryData(["me"], nu)} />}
                {busy === mode && <p className="mt-3 text-xs text-[color:var(--sc-accent)]">{tr("Activation…")}</p>}
              </div>
            );
          })}
        </div>
        <button onClick={() => endSession()} className="text-xs text-muted-foreground hover:text-foreground" data-testid="mode-logout">{tr("Se déconnecter")}</button>
      </div>
    </div>
  );
}