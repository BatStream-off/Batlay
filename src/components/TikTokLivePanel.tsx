import { useEffect, useState, type FormEvent } from "react";
import { Copy, KeyRound, LogOut, Radio } from "lucide-react";
import { Button, SectionTitle, StatusPill } from "@/components/ui";
import { SelectField, ToggleField } from "@/components/editor/fields";
import { useToastStore } from "@/stores/useToastStore";
import { initialTikTokState, parseTikTokUsername, type TikTokLiveState } from "../../electron/shared/tiktok";

/**
 * Carte « TikTok » de la page Alertes : Batlay se branche lui-même sur le live
 * (pseudo seulement, aucun mot de passe). L'adresse locale pour un outil tiers
 * (TikFinity, Streamer.bot…) reste disponible, repliée.
 */

const STATUS: Record<TikTokLiveState["status"], { tone: "ok" | "warn" | "neutral"; label: string }> = {
  idle: { tone: "neutral", label: "Déconnecté" },
  connecting: { tone: "neutral", label: "Connexion…" },
  live: { tone: "ok", label: "En live" },
  waiting: { tone: "warn", label: "En attente du live" },
  error: { tone: "warn", label: "Erreur" },
};

const GIFT_MIN_OPTIONS = [
  { value: 1, label: "Tous les cadeaux" },
  { value: 5, label: "5 diamants et plus" },
  { value: 10, label: "10 diamants et plus" },
  { value: 50, label: "50 diamants et plus" },
  { value: 100, label: "100 diamants et plus" },
  { value: 500, label: "500 diamants et plus" },
  { value: 1000, label: "1 000 diamants et plus" },
];

function untilText(at: number | null, now: number): string | null {
  if (!at) return null;
  const s = Math.max(0, Math.round((at - now) / 1000));
  return s >= 60 ? `nouvel essai dans ${Math.ceil(s / 60)} min` : `nouvel essai dans ${s} s`;
}

export function TikTokLivePanel({
  sourceEnabled,
  onSourceEnabled,
  hookUrl,
  onRegenerateKey,
  copy,
}: {
  sourceEnabled: boolean;
  onSourceEnabled: (on: boolean) => void;
  hookUrl: string;
  onRegenerateKey: () => Promise<void>;
  copy: (text: string, message: string) => Promise<void>;
}) {
  const push = useToastStore((s) => s.push);
  const [state, setState] = useState<TikTokLiveState>(() => initialTikTokState());
  const [input, setInput] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    let alive = true;
    void window.batlay.tiktok
      .getState()
      .then((s) => {
        if (!alive) return;
        setState(s);
        if (s.settings.username) setInput(`@${s.settings.username}`);
      })
      .catch(() => undefined);
    const off = window.batlay.tiktok.onState((s) => alive && setState(s));
    return () => {
      alive = false;
      off();
    };
  }, []);

  // Compte à rebours du prochain essai.
  useEffect(() => {
    if (!state.retryAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [state.retryAt]);

  const active = state.settings.enabled;
  const parsed = parseTikTokUsername(input);
  const status = STATUS[state.status];

  async function connect(e: FormEvent) {
    e.preventDefault();
    if (!parsed) {
      push("Pseudo TikTok non valable : lettres, chiffres, « _ » et « . » (exemple : @mon.pseudo).", "error");
      return;
    }
    const ok = await window.batlay.tiktok.connect(parsed);
    if (!ok) push("Pseudo TikTok non valable.", "error");
  }

  return (
    <section className="card p-6">
      <SectionTitle actions={<ToggleField label="Activé" checked={sourceEnabled} onChange={onSourceEnabled} />}>TikTok</SectionTitle>

      {!active ? (
        <form className="mt-3 space-y-2" onSubmit={(e) => void connect(e)}>
          <label className="block">
            <span className="mb-1 block text-[11px] text-muted">Votre pseudo TikTok</span>
            <div className="flex items-center gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="@pseudo"
                autoComplete="off"
                spellCheck={false}
                aria-label="Pseudo TikTok"
                className="min-w-0 flex-1 rounded-lg border border-base-700 bg-base-800 px-3 py-2 text-sm text-fg outline-none focus:border-signal-500"
              />
              <Button type="submit" size="sm" variant="primary" disabled={!parsed}>
                <Radio size={14} /> Se connecter
              </Button>
            </div>
          </label>
          <p className="text-xs text-muted">
            Pas de mot de passe : le pseudo suffit. Batlay attend votre live et s'y branche tout seul, puis affiche les follows, les nouveaux
            Super Fans (abonnés) et les cadeaux.
          </p>
          {state.status === "idle" && state.settings.username && <p className="text-[11px] text-faint">Dernier compte suivi : @{state.settings.username}.</p>}
        </form>
      ) : (
        <div className="mt-3 space-y-2 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="font-medium text-fg">@{state.settings.username}</span>
              <StatusPill tone={status.tone}>{status.label}</StatusPill>
            </div>
            <Button size="sm" variant="ghost" onClick={() => void window.batlay.tiktok.disconnect()} title="Batlay arrête de suivre ce live">
              <LogOut size={14} /> Déconnecter
            </Button>
          </div>
          {state.message && (
            <p className={`text-xs ${state.status === "error" ? "text-warn-strong" : "text-muted"}`}>
              {state.message}
              {state.status === "waiting" && untilText(state.retryAt, now) && <span className="mt-0.5 block text-[11px] text-faint">{untilText(state.retryAt, now)?.replace(/^n/, "N")}.</span>}
            </p>
          )}
          {state.status === "error" && (
            <Button size="sm" onClick={() => void window.batlay.tiktok.connect(state.settings.username ?? "")}>
              Réessayer
            </Button>
          )}
        </div>
      )}

      <div className="mt-4">
        <SelectField<number>
          label="Alertes de cadeaux"
          value={state.settings.giftMinDiamonds}
          options={GIFT_MIN_OPTIONS.some((o) => o.value === state.settings.giftMinDiamonds) ? GIFT_MIN_OPTIONS : [...GIFT_MIN_OPTIONS, { value: state.settings.giftMinDiamonds, label: `${state.settings.giftMinDiamonds} diamants et plus` }]}
          onChange={(giftMinDiamonds) => void window.batlay.tiktok.updateSettings({ giftMinDiamonds }).then((settings) => setState((s) => ({ ...s, settings })))}
        />
        <p className="mt-1 text-[11px] text-faint">Valeur du cadeau, quantité comprise : 1 Rose = 1 diamant. Une série de cadeaux donne une seule alerte.</p>
      </div>

      <details className="mt-3 text-xs text-muted">
        <summary className="cursor-pointer hover:text-fg">À savoir</summary>
        <p className="mt-2">
          TikTok ne propose pas d'accès officiel aux événements d'un live. Batlay utilise une bibliothèque communautaire (non officielle), qui fait
          valider la connexion par un service tiers, Euler Stream : il reçoit votre pseudo, jamais de mot de passe. Batlay lit seulement : il
          n'écrit rien dans votre live. Ce fonctionnement peut cesser si TikTok change son site, et n'est pas autorisé par TikTok.
        </p>
      </details>

      <details className="mt-2 text-xs text-muted">
        <summary className="cursor-pointer hover:text-fg">Utiliser un autre outil (TikFinity, Streamer.bot…)</summary>
        <div className="mt-2 flex items-center gap-2">
          <input
            readOnly
            value={hookUrl}
            aria-label="Adresse locale des alertes TikTok"
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-lg border border-base-700 bg-base-800 px-3 py-2 font-mono text-[11px] text-fg outline-none focus:border-signal-500"
          />
          <Button size="sm" onClick={() => void copy(hookUrl, "Adresse copiée.")}>
            <Copy size={14} />
          </Button>
        </div>
        <ul className="mt-2 space-y-1.5 font-mono text-[11px] text-fg">
          <li>{hookUrl}?type=follow&amp;user=NOM</li>
          <li>{hookUrl}?type=tiktokGift&amp;user=NOM&amp;gift=Rose&amp;amount=5</li>
        </ul>
        <p className="mt-2">
          Si vous utilisez un autre outil, déconnectez Batlay ci-dessus pour éviter les alertes en double. Requête GET ou POST (JSON). Types : follow,
          subscribe, resub, gift, tiktokGift.
        </p>
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-[11px] text-faint">La clé à la fin de l'adresse empêche quiconque d'autre de déclencher vos alertes.</p>
          <Button size="sm" variant="ghost" title="L'ancienne adresse cesse de fonctionner" onClick={() => void onRegenerateKey()}>
            <KeyRound size={14} /> Nouvelle clé
          </Button>
        </div>
      </details>
    </section>
  );
}
