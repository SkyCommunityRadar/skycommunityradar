import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { GraduationCap, Radio, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OpenForm } from "@/components/AtcPositionPanel";
import { apiDelete, apiGet } from "@/lib/api";
import { errMsg } from "@/lib/hooks";
import type { AtcPosition } from "@/lib/types";
import { tr } from "@/lib/i18n";

/** Profil « Pilote ATC (formation) » — réservé aux instructeurs.
 *  Les positions ouvertes ici sont FICTIVES : elles n'existent que pour l'instructeur, ne sont jamais envoyées
 *  au bot Discord (aucun salon, aucune annonce) et ne sont ni visibles des autres membres, ni comptées. */
export default function TrainingPanel() {
  const qc = useQueryClient();
  const q = useQuery<AtcPosition[]>({ queryKey: ["atc-training-positions"], queryFn: () => apiGet<AtcPosition[]>("/atc/training/positions"), refetchInterval: 30_000 });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["atc-training-positions"] });
    qc.invalidateQueries({ queryKey: ["atc-atis-me"] });
    qc.invalidateQueries({ queryKey: ["atc-frequency"] });
  };
  const close = useMutation({
    mutationFn: (callsign?: string) => apiDelete<{ ok: boolean }>(callsign ? `/atc/training/positions/${callsign}` : "/atc/training/positions/me"),
    onSuccess: (_r, cs) => toast.success(cs ? tr("Position {0} fermée", [cs]) : tr("Positions fermées")),
    onError: (e) => toast.error(errMsg(e)),
    onSettled: refresh,
  });
  const list = q.data ?? [];
  return (
    <div className="space-y-3 text-sm" data-testid="training-panel">
      <div className="space-y-1 rounded-xl border border-violet-400/40 bg-violet-500/10 p-3" data-testid="training-notice">
        <div className="flex items-center gap-2 font-semibold text-violet-200">
          <GraduationCap className="h-4 w-4" />{tr("Mode formation (fictif)")}
        </div>
        <p className="text-xs text-violet-100/80">
          {tr("Toutes les fonctions ATC sont disponibles (ouvrir une fréquence, strips, contrôler un vol, déposer un plan de vol). Vos positions restent fictives : rien n'est envoyé au bot Discord, les autres membres ne les voient pas, et rien n'est compté sur le profil réel.")}
        </p>
      </div>

      <div className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        <span className="flex items-center gap-2"><Radio className="h-3.5 w-3.5" />{tr("Mes positions de formation")}</span>
        <span className="rounded-full bg-violet-500/20 px-2 py-0.5 text-[11px] text-violet-200" data-testid="training-count">{list.length}</span>
      </div>
      {list.length === 0 && <p className="rounded-xl border border-dashed border-border px-3 py-3 text-muted-foreground" data-testid="training-empty">{tr("Aucune position de formation ouverte.")}</p>}
      <ul className="space-y-1.5">
        {list.map((p) => (
          <li key={p.id} className="flex items-center gap-3 rounded-lg border border-violet-400/30 bg-background/40 px-3 py-2" data-testid={`training-${p.callsign}`}>
            <span className="rounded bg-violet-500/25 px-1.5 py-px text-[10px] font-bold uppercase tracking-wide text-violet-200">{tr("Formation")}</span>
            <span className="flex-1 truncate font-mono text-xs">{p.callsign}</span>
            <span className="font-mono font-bold text-amber-200">{p.frequency}</span>
            <button onClick={() => close.mutate(p.callsign)} disabled={close.isPending} className="rounded-md p-1 text-muted-foreground hover:bg-red-500/20 hover:text-red-300" title={tr("Fermer {0}", [p.callsign])} data-testid={`training-close-${p.callsign}`}>
              <X className="h-4 w-4" />
            </button>
          </li>
        ))}
      </ul>
      {list.length > 1 && <Button size="xs" variant="outline" onClick={() => close.mutate(undefined)} disabled={close.isPending}>{tr("Fermer toutes mes positions")}</Button>}
      <OpenForm training onDone={refresh} />
    </div>
  );
}