import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Copy, MessageSquare, Play, RefreshCw, Send } from "lucide-react";
import { playEnter, prefersReducedMotion } from "@/animation/engine";
import { enterEffectOptions, exitEffectOptions } from "@/animation/effects";
import { useTwitchStore } from "@/stores/useTwitchStore";
import { useToastStore } from "@/stores/useToastStore";
import { Button, SelectMenu, StatusPill } from "@/components/ui";
import { chatStatus } from "@/utils/twitch-ui";
import {
  DEFAULT_OPTIONS,
  FONT_STACKS,
  buildOverlaySearch,
  chatMotion,
  parseOverlayOptions,
  readableNameColor,
  type ChatFont,
  type ChatMotion,
  type OverlayOptions,
} from "../../twitch-overlay/chat-feed";

/**
 * Section « Chat » de la page Overlays. L'overlay de chat n'a pas d'éditeur de
 * canvas : il se règle ici (taille, nombre de messages, disparition, badges,
 * fond) et ces réglages sont simplement écrits dans l'URL de la source OBS.
 * Les réglages sont mémorisés localement, sans rapport avec ceux des overlays musicaux.
 */

const STORAGE_KEY = "batlay.chatOverlayOptions";

/** Réglages mémorisés de l'overlay Chat (aussi lus par la page Intégrations, pour proposer la même URL). */
export function loadOptions(): OverlayOptions {
  try {
    return parseOverlayOptions(localStorage.getItem(STORAGE_KEY) ?? "");
  } catch {
    return DEFAULT_OPTIONS;
  }
}
function saveOptions(options: OverlayOptions): void {
  try {
    localStorage.setItem(STORAGE_KEY, buildOverlaySearch(options));
  } catch {
    /* stockage indisponible : les réglages restent valables pour cette session */
  }
}

const FADE_OPTIONS = [
  { value: "0", label: "Jamais" },
  { value: "15", label: "Après 15 s" },
  { value: "30", label: "Après 30 s" },
  { value: "60", label: "Après 1 min" },
  { value: "120", label: "Après 2 min" },
];

const FONT_OPTIONS: { value: ChatFont; label: string }[] = [
  { value: "segoe", label: "Segoe UI (défaut)" },
  { value: "arial", label: "Arial" },
  { value: "serif", label: "Georgia (serif)" },
  { value: "mono", label: "Consolas (mono)" },
];

const MOTION_OPTIONS: { value: ChatMotion; label: string }[] = [
  { value: "auto", label: "Respecter Windows" },
  { value: "on", label: "Toujours animer" },
  { value: "off", label: "Aucune animation" },
];

const SAMPLE = [
  { name: "Nyx_Live", color: "#b58cff", text: "GG, cette partie était folle" },
  { name: "Kaya", color: "#ff6b81", text: "on est là depuis le début !" },
  { name: "Batlay", color: "#37e29a", text: "Le chat s'affichera comme ceci dans OBS." },
];

export function ChatOverlaySection() {
  const navigate = useNavigate();
  const { state, sendTest, restartOverlay } = useTwitchStore((s) => ({
    state: s.state,
    sendTest: s.sendTest,
    restartOverlay: s.restartOverlay,
  }));
  const push = useToastStore((s) => s.push);
  const [options, setOptions] = useState<OverlayOptions>(loadOptions);
  const status = chatStatus(state);
  const url = useMemo(() => `${state.server.overlayUrl}${buildOverlaySearch(options)}`, [state.server.overlayUrl, options]);

  function update(patch: Partial<OverlayOptions>) {
    // Repasse par le même analyseur que l'overlay : mêmes bornes, jamais de valeur hors limites.
    const next = parseOverlayOptions(buildOverlaySearch({ ...options, ...patch }));
    setOptions(next);
    saveOptions(next);
  }

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(url);
      push("URL de l'overlay Chat copiée — collez-la dans une source « Navigateur » d'OBS.", "success");
    } catch {
      push("Copie impossible : sélectionnez l'URL et copiez-la à la main.", "error");
    }
  }

  async function restartLink() {
    const count = await restartOverlay();
    if (count > 0) {
      push(`Lien OBS redémarré — ${count} source${count > 1 ? "s" : ""} rechargée${count > 1 ? "s" : ""}.`, "success");
    } else {
      push("Aucune source OBS connectée : rien à redémarrer. Vérifiez que l'URL est collée dans une source « Navigateur ».", "error");
    }
  }

  const preview = options.newestTop ? [...SAMPLE].reverse() : SAMPLE;

  // Aperçu des animations : rejoue l'arrivée des messages d'exemple à chaque changement de réglage.
  const previewRef = useRef<HTMLDivElement>(null);
  const [replay, setReplay] = useState(0);
  const animKey = `${options.enterEffect}|${options.animMs}|${options.motion}|${replay}`;
  const firstAnim = useRef(true);
  useEffect(() => {
    if (firstAnim.current) {
      firstAnim.current = false;
      return;
    }
    const m = chatMotion(options, prefersReducedMotion());
    Array.from(previewRef.current?.children ?? []).forEach((row, i) => {
      const spec = m.enter && { ...m.enter, delayMs: i * 120 };
      playEnter(row, spec, { distance: spec ? m.distance(spec.effect) : undefined });
    });
    // `options` est lu au moment du rejeu ; animKey en résume les champs utiles.
  }, [animKey]);

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 className="flex items-center gap-2 font-medium text-fg">
            <MessageSquare size={16} className="text-accent" /> Chat Twitch
          </h3>
          <p className="mt-0.5 text-xs text-muted">
            {state.account ? `Chaîne de ${state.account.displayName}` : "Aucun compte connecté"} · serveur sur le port {state.server.port}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <StatusPill tone={status.tone}>{status.label}</StatusPill>
          {state.status !== "connected" && (
            <Button size="sm" variant="primary" onClick={() => navigate("/chat")}>
              Connecter le compte
            </Button>
          )}
        </div>
      </div>

      <div className="mt-5 grid gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* Aperçu : fond de scène fixe, comme pour les overlays musicaux. */}
        <div
          ref={previewRef}
          className={`flex min-h-[11rem] flex-col gap-1.5 overflow-hidden rounded-xl bg-stage p-3 ${options.newestTop ? "justify-start" : "justify-end"}`}
          style={{ fontFamily: FONT_STACKS[options.font] }}
          aria-label="Aperçu"
        >
          {preview.map((m) => (
            <div
              key={m.name}
              className={`max-w-full text-white ${options.background ? "w-fit rounded-lg px-2 py-1" : ""}`}
              style={{
                fontSize: Math.max(10, Math.min(options.size * 0.6, 26)),
                textShadow: options.shadow ? "0 1px 3px rgba(0,0,0,.9)" : "none",
                backgroundColor: options.background ? `rgba(10,10,15,${options.bgOpacity / 100})` : undefined,
              }}
            >
              <span className="font-bold" style={{ color: readableNameColor(m.color, m.name) }}>
                {m.name}
              </span>
              : {m.text}
            </div>
          ))}
        </div>

        <div className="space-y-3 text-sm">
          <Range label="Taille du texte" unit=" px" min={12} max={72} value={options.size} onChange={(size) => update({ size })} />
          <Range label="Messages affichés" min={1} max={100} value={options.max} onChange={(max) => update({ max })} />
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="chat-fade" className="text-muted">
              Disparition
            </label>
            <div className="w-40">
              <SelectMenu
                id="chat-fade"
                value={String(options.fadeMs / 1000)}
                options={FADE_OPTIONS}
                onChange={(v) => update({ fadeMs: Number(v) * 1000 })}
              />
            </div>
          </div>
          <Range label="Largeur" unit=" px" min={0} max={1920} step={10} autoAtZero value={options.width} onChange={(width) => update({ width })} />
          <Range label="Hauteur" unit=" px" min={0} max={1080} step={10} autoAtZero value={options.height} onChange={(height) => update({ height })} />
          <Check label="Afficher les badges" checked={options.showBadges} onChange={(showBadges) => update({ showBadges })} />
          <Check label="Fond sombre derrière les messages" checked={options.background} onChange={(background) => update({ background })} />
          {options.background && (
            <Range label="Opacité du fond" unit=" %" min={10} max={100} value={options.bgOpacity} onChange={(bgOpacity) => update({ bgOpacity })} />
          )}
          <div className="flex items-center justify-between gap-3">
            <label htmlFor="chat-font" className="text-muted">
              Police
            </label>
            <div className="w-40">
              <SelectMenu id="chat-font" value={options.font} options={FONT_OPTIONS} onChange={(v) => update({ font: v as ChatFont })} />
            </div>
          </div>
          <Check label="Ombre et contour du texte" checked={options.shadow} onChange={(shadow) => update({ shadow })} />
          <Check label="Masquer les commandes (!…)" checked={options.hideCommands} onChange={(hideCommands) => update({ hideCommands })} />
          <Check label="Nouveaux messages en haut" checked={options.newestTop} onChange={(newestTop) => update({ newestTop })} />
          <div className="space-y-3 border-t border-line pt-3">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-fg">Animations</span>
              <button
                type="button"
                onClick={() => setReplay((n) => n + 1)}
                className="inline-flex items-center gap-1 text-xs text-muted hover:text-fg"
                title="Rejouer l'arrivée des messages dans l'aperçu"
              >
                <Play size={12} className="text-accent" /> Aperçu
              </button>
            </div>
            <ChatSelect id="chat-enter" label="Arrivée" value={options.enterEffect} options={enterEffectOptions()} onChange={(v) => update({ enterEffect: v as OverlayOptions["enterEffect"] })} />
            <ChatSelect id="chat-exit" label="Départ" value={options.exitEffect} options={exitEffectOptions()} onChange={(v) => update({ exitEffect: v as OverlayOptions["exitEffect"] })} />
            <Range label="Durée" unit=" ms" min={50} max={1000} step={10} value={options.animMs} onChange={(animMs) => update({ animMs })} />
            <ChatSelect id="chat-motion" label="Mouvement réduit" value={options.motion} options={MOTION_OPTIONS} onChange={(v) => update({ motion: v as ChatMotion })} />
            <p className="text-[11px] text-faint">
              Le départ s'applique aux messages qui disparaissent (délai ou nombre maximal atteint). Un message supprimé par la modération
              disparaît toujours immédiatement.
            </p>
          </div>
        </div>
      </div>

      <div className="mt-5 flex items-center gap-2 border-t border-line pt-4">
        <input
          readOnly
          value={url}
          aria-label="URL de l'overlay Chat pour OBS"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-lg border border-base-700 bg-base-800 px-3 py-2 font-mono text-xs text-fg outline-none focus:border-signal-500"
        />
        <Button onClick={() => void copyUrl()} disabled={!state.server.running}>
          <Copy size={14} /> Copier l'URL OBS
        </Button>
        <Button onClick={() => void sendTest()} disabled={!state.server.running} title="Affiche un faux message dans OBS">
          <Send size={14} /> Test
        </Button>
        <Button
          onClick={() => void restartLink()}
          disabled={!state.server.running}
          title="Recharge la page du chat dans les sources OBS connectées"
        >
          <RefreshCw size={14} /> Redémarrer le lien
        </Button>
      </div>
      <p className="mt-2 text-xs text-muted">
        {state.overlayClients > 0
          ? `${state.overlayClients} source${state.overlayClients > 1 ? "s" : ""} OBS connectée${state.overlayClients > 1 ? "s" : ""}. `
          : "Aucune source OBS connectée. "}
        Les réglages sont inclus dans l'URL : recopiez-la dans OBS après un changement.
      </p>
    </div>
  );
}

function ChatSelect({
  id,
  label,
  value,
  options,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="text-muted">
        {label}
      </label>
      <div className="w-48">
        <SelectMenu id={id} value={value} options={options} onChange={onChange} />
      </div>
    </div>
  );
}

function Range({
  label,
  unit = "",
  min,
  max,
  step = 1,
  value,
  onChange,
  autoAtZero = false,
}: {
  label: string;
  unit?: string;
  /** Affiche « Auto » à la place de 0 (taille laissée à la source OBS). */
  autoAtZero?: boolean;
  min: number;
  max: number;
  step?: number;
  value: number;
  onChange: (value: number) => void;
}) {
  const id = `chat-${label.replace(/\W+/g, "-").toLowerCase()}`;
  return (
    <div className="flex items-center justify-between gap-3">
      <label htmlFor={id} className="shrink-0 text-muted">
        {label}
      </label>
      <div className="flex items-center gap-2">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="w-28 accent-[rgb(var(--signal-500))]"
        />
        <span className="w-14 text-right tabular-nums text-fg">
          {autoAtZero && value === 0 ? "Auto" : value}
          {autoAtZero && value === 0 ? "" : unit}
        </span>
      </div>
    </div>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-muted">
      <span>{label}</span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="h-4 w-4 accent-[rgb(var(--signal-500))]"
      />
    </label>
  );
}
