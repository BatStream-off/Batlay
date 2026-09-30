import { useEffect, useState } from "react";
import { Copy, Loader2, Lock, RotateCcw, Send } from "lucide-react";
import { useTwitchStore } from "@/stores/useTwitchStore";
import { useToastStore } from "@/stores/useToastStore";
import { Button, PageHeader, SectionTitle, StatusPill } from "@/components/ui";
import { accountStatus, channelLabel, chatStatus, describeTokenExpiry, isOtherChannel } from "@/utils/twitch-ui";
import { TWITCH_OVERLAY_URL, TWITCH_PORT, TWITCH_REDIRECT_URI, parseTwitchChannel } from "../../electron/shared/twitch";

const OBS_OPTIONS: { param: string; effect: string }[] = [
  { param: "size=28", effect: "taille du texte en pixels (12 à 72, 22 par défaut)" },
  { param: "max=15", effect: "nombre de messages affichés (1 à 100, 20 par défaut)" },
  { param: "fade=30", effect: "disparition des messages après 30 secondes (0 = jamais)" },
  { param: "badges=0", effect: "masque les badges (modérateur, abonné…)" },
  { param: "bg=1", effect: "ajoute un fond sombre translucide derrière chaque message" },
];

export function Twitch() {
  const { state, ready, connect, cancel, disconnect, sendTest, setChannel } = useTwitchStore((s) => ({
    state: s.state,
    ready: s.ready,
    connect: s.connect,
    cancel: s.cancel,
    disconnect: s.disconnect,
    sendTest: s.sendTest,
    setChannel: s.setChannel,
  }));
  const push = useToastStore((s) => s.push);
  const [now, setNow] = useState(() => Date.now());
  // Saisie du champ « chaîne » : pseudo ou lien. Repart de la chaîne mémorisée quand elle change côté Batlay.
  const [channelInput, setChannelInput] = useState(state.channelLogin ?? "");
  const [applying, setApplying] = useState(false);
  useEffect(() => setChannelInput(state.channelLogin ?? ""), [state.channelLogin]);

  // Le temps restant de la session se rafraîchit à la minute.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  const account = accountStatus(state);
  const chat = chatStatus(state);
  const serverUp = state.server.running;
  const connected = state.status === "connected";
  const waiting = state.status === "authorizing" || state.status === "validating";

  async function copyUrl() {
    try {
      await navigator.clipboard.writeText(state.server.overlayUrl);
      push("URL du chat copiée — collez-la dans une source « Navigateur » d'OBS.", "success");
    } catch {
      push("Copie impossible : sélectionnez l'URL et copiez-la à la main.", "error");
    }
  }

  const typedLogin = parseTwitchChannel(channelInput);
  const typedInvalid = channelInput.trim() !== "" && typedLogin === null;
  // Vide ou pseudo du compte connecté = « ma chaîne » ; sinon on compare au choix déjà enregistré.
  const wantedLogin = channelInput.trim() === "" || typedLogin === state.account?.login ? null : typedLogin;
  const channelUnchanged = !typedInvalid && wantedLogin === state.channelLogin;
  const otherChannel = isOtherChannel(state);

  async function applyChannel(next: string | null) {
    setApplying(true);
    try {
      const ok = await setChannel(next);
      if (!ok) return; // l'erreur « pseudo non reconnu » est affichée par l'état
      push(
        next
          ? connected
            ? `Chat de « ${next} » demandé : vérification auprès de Twitch…`
            : `Chaîne « ${next} » enregistrée : le chat s'affichera une fois Twitch connecté.`
          : "Le chat de votre propre chaîne est de nouveau affiché.",
        "success"
      );
    } finally {
      setApplying(false);
    }
  }

  async function handleSendTest() {
    await sendTest();
    push(
      state.overlayClients > 0
        ? "Message de test envoyé à OBS."
        : "Aucune source OBS connectée pour l'instant : ajoutez l'URL du chat dans OBS pour voir le message.",
      state.overlayClients > 0 ? "success" : "info"
    );
  }

  return (
    <div className="stagger mx-auto max-w-3xl px-8 py-10">
      <PageHeader
        title="Chat"
        subtitle="Affichez dans OBS le chat Twitch de votre chaîne, ou de n'importe quelle autre. Indépendant de la musique : les deux overlays fonctionnent en même temps."
      />

      {state.error && (
        <div role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-danger-soft">
          {state.error.message}
        </div>
      )}
      {state.warning && (
        <div role="status" className="mt-4 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-sm text-warn">
          {state.warning.message}
        </div>
      )}

      {/* --- Compte --- */}
      <section className={`mt-6 card p-6 ${connected ? "card-live" : ""}`}>
        <div className="flex items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={state.account?.displayName ?? "Twitch"} url={state.account?.profileImageUrl ?? null} />
            <div className="min-w-0">
              <h2 className="truncate font-medium text-fg">
                {state.account ? state.account.displayName : "Compte Twitch"}
                {state.account && <span className="ml-2 text-xs font-normal text-muted">@{state.account.login}</span>}
              </h2>
              <p className="mt-0.5 flex items-center gap-2 text-sm">
                {account.busy && <Loader2 size={14} className="animate-spin text-muted" aria-hidden="true" />}
                {account.tone === "ok" && <span className="dot-live h-2 w-2 rounded-full" aria-hidden="true" />}
                <span className={account.tone === "ok" ? "text-ok" : "text-muted"}>{account.label}</span>
              </p>
            </div>
          </div>
          <div className="shrink-0">
            {connected ? (
              <Button onClick={() => void disconnect()}>Déconnecter</Button>
            ) : waiting ? (
              <Button onClick={() => void cancel()} disabled={state.status === "validating"}>
                Annuler
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void connect()} disabled={!ready || !serverUp}>
                Connecter Twitch
              </Button>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-1.5 border-t border-line pt-4 text-xs text-muted">
          {connected ? (
            <>
              <p>{describeTokenExpiry(state.tokenExpiresAt, now)} Batlay la contrôle chaque heure.</p>
              <p>
                « Déconnecter » révoque l'accès chez Twitch et efface le jeton de cet ordinateur.
              </p>
            </>
          ) : (
            <>
              <p>
                Un onglet Twitch s'ouvre pour autoriser Batlay à <strong>lire le chat</strong>
                (permission <code className="rounded bg-base-800 px-1 py-0.5">user:read:chat</code>). Batlay ne peut rien
                publier ni modérer en votre nom.
              </p>
              <p>Le jeton est chiffré par votre système et n'est jamais transmis à cette interface.</p>
            </>
          )}
        </div>
      </section>

      {/* --- Chaîne affichée --- */}
      <section className="mt-4 card p-6">
        <SectionTitle hint="Votre chaîne par défaut, ou celle de n'importe quel streamer : collez un pseudo ou un lien Twitch.">
          Chaîne affichée
        </SectionTitle>

        <div className="mt-4 flex items-center gap-2">
          <input
            value={channelInput}
            onChange={(e) => setChannelInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !typedInvalid && !channelUnchanged && !applying) void applyChannel(wantedLogin);
            }}
            placeholder="pseudo ou lien (ex. twitch.tv/pseudo) — vide = ma chaîne"
            aria-label="Pseudo ou lien Twitch de la chaîne à afficher"
            aria-invalid={typedInvalid}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            className={`min-w-0 flex-1 rounded-lg border bg-base-800 px-3 py-2 text-sm text-fg outline-none placeholder:text-faint focus:border-signal-500 ${
              typedInvalid ? "border-red-500/60" : "border-base-700"
            }`}
          />
          <Button variant="primary" onClick={() => void applyChannel(wantedLogin)} disabled={typedInvalid || channelUnchanged || applying}>
            {applying && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Afficher ce chat
          </Button>
        </div>

        <p className={`mt-2 text-xs ${typedInvalid ? "text-danger-soft" : "text-muted"}`} aria-live="polite">
          {typedInvalid
            ? "Pseudo ou lien non reconnu. Exemples : ninja, @ninja, https://www.twitch.tv/ninja"
            : typedLogin
              ? `Chaîne détectée : @${typedLogin}`
              : "Laissez vide pour afficher le chat de votre propre chaîne."}
        </p>

        <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4">
          <div className="flex min-w-0 items-center gap-3">
            {state.channel ? (
              <Avatar name={state.channel.displayName} url={state.channel.profileImageUrl} size="sm" />
            ) : null}
            <p className="min-w-0 truncate text-sm text-fg">
              {state.channel ? (
                <>
                  Chat affiché : <strong>{channelLabel(state)}</strong>
                  <span className="ml-2 text-xs text-muted">@{state.channel.login}</span>
                  <span className="ml-2 text-xs text-muted">{otherChannel ? "· autre chaîne" : "· votre chaîne"}</span>
                </>
              ) : connected ? (
                <span className="text-muted">
                  {state.channelLogin ? `Chaîne @${state.channelLogin} : en attente de Twitch…` : "Chat de votre chaîne : démarrage…"}
                </span>
              ) : (
                <span className="text-muted">
                  {state.channelLogin
                    ? `Chaîne choisie : @${state.channelLogin} (s'affichera une fois Twitch connecté)`
                    : "Votre chaîne (une fois Twitch connecté)"}
                </span>
              )}
            </p>
          </div>
          {state.channelLogin && (
            <Button size="sm" onClick={() => void applyChannel(null)} disabled={applying}>
              <RotateCcw size={14} /> Ma chaîne
            </Button>
          )}
        </div>

        <p className="mt-3 text-xs text-muted">
          Pas besoin d'être modérateur ni d'avoir la permission du streamer : le chat est public. Le compte connecté
          ci-dessus sert uniquement à lire, Batlay ne publie rien.
        </p>
      </section>

      {/* --- Chat dans OBS --- */}
      <section className="mt-4 card p-6">
        <SectionTitle
          actions={<StatusPill tone={chat.tone}>{chat.label}</StatusPill>}
          hint="Une source Navigateur d'OBS suffit ; elle se met à jour toute seule."
        >
          Chat dans OBS
        </SectionTitle>

        <div className="mt-4 flex items-center gap-2">
          <input
            readOnly
            value={state.server.overlayUrl}
            aria-label="URL du chat Twitch pour OBS"
            onFocus={(e) => e.currentTarget.select()}
            className="min-w-0 flex-1 rounded-lg border border-base-700 bg-base-800 px-3 py-2 font-mono text-xs text-fg outline-none focus:border-signal-500"
          />
          <Button onClick={() => void copyUrl()} disabled={!serverUp}>
            <Copy size={14} /> Copier
          </Button>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted">
            {state.overlayClients > 0
              ? `${state.overlayClients} source${state.overlayClients > 1 ? "s" : ""} OBS connectée${state.overlayClients > 1 ? "s" : ""}.`
              : "Aucune source OBS connectée pour le moment."}
          </p>
          <Button size="sm" onClick={() => void handleSendTest()} disabled={!serverUp}>
            <Send size={14} /> Envoyer un message de test
          </Button>
        </div>

        <ol className="mt-4 list-decimal space-y-1 border-t border-line pt-4 pl-5 text-xs text-muted">
          <li>Dans OBS : Sources → + → Navigateur.</li>
          <li>Collez l'URL ci-dessus. Taille conseillée : 420 × 640 (largeur × hauteur).</li>
          <li>Le fond est transparent ; le message le plus récent reste en bas.</li>
        </ol>

        <details className="mt-4 border-t border-line pt-4">
          <summary className="cursor-pointer text-xs font-medium text-fg">Personnaliser l'affichage</summary>
          <p className="mt-2 text-xs text-muted">
            Ajoutez des réglages à la fin de l'URL, par exemple{" "}
            <code className="rounded bg-base-800 px-1 py-0.5">{TWITCH_OVERLAY_URL}?size=28&amp;max=12&amp;bg=1</code>
          </p>
          <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-xs">
            {OBS_OPTIONS.map(({ param, effect }) => (
              <div key={param} className="contents">
                <dt>
                  <code className="rounded bg-base-800 px-1 py-0.5 text-fg">{param}</code>
                </dt>
                <dd className="text-muted">{effect}</dd>
              </div>
            ))}
          </dl>
        </details>
      </section>

      {/* --- Serveur --- */}
      <section className="mt-4 card p-6">
        <SectionTitle>Serveur Twitch</SectionTitle>
        <div className="mt-3 flex items-center justify-between text-sm text-fg">
          <span>État</span>
          <StatusPill tone={serverUp ? "ok" : "warn"}>{serverUp ? "● En ligne" : "● Hors ligne"}</StatusPill>
        </div>
        <div className="mt-3 flex items-center justify-between text-sm text-fg">
          <span className="flex items-center gap-1.5">
            Port <Lock size={12} className="text-faint" aria-label="Verrouillé" />
          </span>
          <span className="rounded-md border border-base-700 bg-base-800 px-2 py-1 font-mono text-sm text-muted" aria-readonly="true">
            {TWITCH_PORT}
          </span>
        </div>
        <p className="mt-3 text-xs text-muted">
          Le port est fixe : il correspond à l'URI de redirection enregistrée chez Twitch (
          <code className="rounded bg-base-800 px-1 py-0.5">{TWITCH_REDIRECT_URI}</code>). Il ne dépend pas du serveur
          d'overlay musical, dont le port se règle dans Paramètres.
        </p>
      </section>
    </div>
  );
}

/** Photo de profil Twitch, ou l'initiale du pseudo tant qu'elle manque ou ne charge pas. */
function Avatar({ name, url, size = "md" }: { name: string; url: string | null; size?: "sm" | "md" }) {
  const box = size === "sm" ? "h-8 w-8" : "h-11 w-11";
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [url]);
  if (url && !failed) {
    return (
      <img
        src={url}
        alt=""
        onError={() => setFailed(true)}
        className={`${box} shrink-0 rounded-full border border-line object-cover`}
      />
    );
  }
  return (
    <span
      className={`btn-primary flex ${box} shrink-0 items-center justify-center rounded-full font-display ${size === "sm" ? "text-sm" : "text-lg"} font-bold`}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}
