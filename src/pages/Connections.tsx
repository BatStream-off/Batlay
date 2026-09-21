import { useEffect, useState, type ReactNode } from "react";
import { useMusicStore } from "@/stores/useMusicStore";
import { useToastStore } from "@/stores/useToastStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { Button, PageHeader, StatusPill } from "@/components/ui";

const inputClass =
  "rounded-lg border border-base-700 bg-base-800 px-3 py-2 text-sm text-fg outline-none focus:border-signal-500";

export function Connections() {
  const {
    activeProviderId,
    isConnecting,
    error,
    connectDemo,
    connectSpotify,
    connectSystemMedia,
    systemMediaProvider,
    disconnect,
  } = useMusicStore((s) => ({
    activeProviderId: s.activeProviderId,
    isConnecting: s.isConnecting,
    error: s.error,
    connectDemo: s.connectDemo,
    connectSpotify: s.connectSpotify,
    connectSystemMedia: s.connectSystemMedia,
    systemMediaProvider: s.systemMediaProvider,
    disconnect: s.disconnect,
  }));
  const push = useToastStore((s) => s.push);
  const { settings, update: updateSettings } = useSettingsStore((s) => ({ settings: s.settings, update: s.update }));

  const [clientId, setClientId] = useState("");
  const [spotifyConfigured, setSpotifyConfigured] = useState(false);
  const [systemMediaSupported, setSystemMediaSupported] = useState(false);
  const [sessions, setSessions] = useState<{ sourceAppId: string | null; title: string; artist: string }[]>([]);
  const [loadingSessions, setLoadingSessions] = useState(false);

  useEffect(() => {
    window.batlay.spotify.isConfigured().then(setSpotifyConfigured);
    window.batlay.systemMedia.isSupported().then(setSystemMediaSupported);
  }, [activeProviderId]);

  // Applique la préférence persistée (Paramètres > lecteur système préféré)
  // au provider dès qu'elle est connue, pour qu'un "Connecter" immédiat
  // suive déjà le bon lecteur sans attendre une interaction sur le menu.
  useEffect(() => {
    if (settings) systemMediaProvider.setPreferredSession(settings.preferredSystemMediaAppId);
  }, [settings, systemMediaProvider]);

  async function refreshSessions() {
    setLoadingSessions(true);
    try {
      const list = await systemMediaProvider.listAvailableSessions();
      setSessions(list);
    } catch (err) {
      push((err as Error).message, "error");
    } finally {
      setLoadingSessions(false);
    }
  }

  useEffect(() => {
    if (systemMediaSupported) void refreshSessions();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [systemMediaSupported]);

  async function handleSelectSession(appId: string) {
    const value = appId || null;
    systemMediaProvider.setPreferredSession(value);
    await updateSettings({ preferredSystemMediaAppId: value });
  }

  async function handleSystemMediaConnect() {
    try {
      await connectSystemMedia();
      push("Lecture système connectée", "success");
    } catch (err) {
      push((err as Error).message, "error");
    }
  }

  async function saveClientId() {
    if (!clientId.trim()) return;
    await window.batlay.spotify.setClientId(clientId.trim());
    setSpotifyConfigured(true);
    push("Client ID Spotify enregistré", "success");
  }

  async function handleSpotifyConnect() {
    try {
      await connectSpotify();
      push("Spotify connecté", "success");
    } catch (err) {
      push((err as Error).message, "error");
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-8 py-10">
      <PageHeader
        title="Connexions"
        subtitle="Choisissez la source musicale de vos overlays. Une seule source est active à la fois."
      />

      {error && (
        <div role="alert" className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-danger-soft">
          {error}
        </div>
      )}

      {/* --- Lecture système (Windows) : la plus simple, donc en premier --- */}
      <ProviderCard
        title="Lecture système (Windows)"
        badge={<StatusPill tone="neutral">Recommandé</StatusPill>}
        connected={activeProviderId === "system-media"}
        action={
          activeProviderId === "system-media" ? (
            <Button onClick={() => void disconnect()}>Déconnecter</Button>
          ) : (
            <Button variant="primary" onClick={handleSystemMediaConnect} disabled={!systemMediaSupported || isConnecting}>
              {isConnecting ? "Connexion..." : "Connecter"}
            </Button>
          )
        }
        first
      >
        <p className="text-xs text-muted">
          Aucun compte, aucun Client ID, aucun abonnement <strong>Premium</strong> requis : ce mode lit directement les
          informations « En cours de lecture » exposées par Windows (les mêmes que le Volet de contrôle multimédia / les
          touches multimédias du clavier). Il fonctionne avec Spotify Free, un navigateur, VLC, etc.
        </p>
        {!systemMediaSupported && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-warn">
            ⚠️ Non disponible sur cette plateforme (nécessite Windows 10 1809+ ou Windows 11).
          </p>
        )}
        {systemMediaSupported && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label htmlFor="system-media-session" className="text-xs font-medium text-muted">
                Lecteur à suivre {sessions.length > 1 && "(plusieurs détectés)"}
              </label>
              <button
                onClick={() => void refreshSessions()}
                disabled={loadingSessions}
                className="text-xs text-accent hover:text-fg disabled:opacity-40"
              >
                {loadingSessions ? "Recherche..." : "Rafraîchir"}
              </button>
            </div>
            <select
              id="system-media-session"
              value={settings?.preferredSystemMediaAppId ?? ""}
              onChange={(e) => void handleSelectSession(e.target.value)}
              className={`w-full ${inputClass}`}
            >
              <option value="">Automatique (suit le focus multimédia Windows)</option>
              {sessions.map((s) => (
                <option key={s.sourceAppId ?? s.title} value={s.sourceAppId ?? ""}>
                  {s.sourceAppId ?? "?"} — {s.title || "Titre inconnu"}
                  {s.artist ? ` · ${s.artist}` : ""}
                </option>
              ))}
            </select>
            {sessions.length === 0 && !loadingSessions && (
              <p className="text-xs text-faint">
                Aucun lecteur actif détecté pour le moment. Lancez une lecture puis cliquez sur « Rafraîchir ».
              </p>
            )}
          </div>
        )}
      </ProviderCard>

      {/* --- Spotify --- */}
      <ProviderCard
        title="Spotify"
        connected={activeProviderId === "spotify"}
        action={
          activeProviderId === "spotify" ? (
            <Button onClick={() => void disconnect()}>Déconnecter</Button>
          ) : (
            <Button variant="primary" onClick={handleSpotifyConnect} disabled={!spotifyConfigured || isConnecting}>
              {isConnecting ? "Connexion..." : "Connecter Spotify"}
            </Button>
          )
        }
      >
        {spotifyConfigured ? (
          <p className="text-xs text-muted">Client ID enregistré. Cliquez sur « Connecter Spotify » pour autoriser Batlay.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted">
              Configuration requise : créez une application sur le <span className="text-accent">Spotify Developer Dashboard</span>,
              ajoutez l'URI de redirection{" "}
              <code className="rounded bg-base-800 px-1 py-0.5">http://127.0.0.1:8945/callback</code> puis collez le Client ID
              ci-dessous.
            </p>
            <p className="text-xs text-muted">
              Le <strong>Client Secret n'est pas nécessaire</strong> (Batlay utilise le flow OAuth PKCE, prévu par Spotify pour
              les apps desktop où un secret ne peut pas être stocké en sécurité).
            </p>
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-warn">
              ⚠️ Tant que votre app reste en <strong>Development Mode</strong> sur le dashboard Spotify, vous devez
              explicitement ajouter votre propre compte Spotify à la liste d'utilisateurs autorisés de l'app (Dashboard &gt;
              votre app &gt; Settings &gt; User Management), sinon l'écran d'autorisation refusera la connexion. Depuis 2026, un
              compte Spotify Premium est aussi requis pour utiliser une app en Development Mode.
            </p>
            <div className="flex gap-2">
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void saveClientId();
                }}
                placeholder="Spotify Client ID"
                aria-label="Spotify Client ID"
                className={`flex-1 ${inputClass}`}
              />
              <Button onClick={() => void saveClientId()} disabled={!clientId.trim()}>
                Enregistrer
              </Button>
            </div>
          </div>
        )}
      </ProviderCard>

      {/* --- Mode démo --- */}
      <ProviderCard
        title="Mode démo"
        connected={activeProviderId === "demo"}
        action={
          activeProviderId === "demo" ? (
            <Button onClick={() => void disconnect()}>Arrêter la démo</Button>
          ) : (
            <Button onClick={() => void connectDemo()} disabled={isConnecting}>
              Lancer la démo
            </Button>
          )
        }
      >
        <p className="text-xs text-muted">Testez Batlay sans compte ni lecteur, avec des morceaux d'exemple.</p>
      </ProviderCard>
    </div>
  );
}

/** Carte d'une source : titre, état, bouton principal, puis le détail spécifique. */
function ProviderCard({
  title,
  badge,
  connected,
  action,
  children,
  first,
}: {
  title: string;
  badge?: ReactNode;
  connected: boolean;
  action: ReactNode;
  children: ReactNode;
  first?: boolean;
}) {
  return (
    <section className={`${first ? "mt-6" : "mt-4"} rounded-xl2 border p-6 ${connected ? "border-live/40" : "border-line"} bg-base-900`}>
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 font-medium text-fg">
            {title}
            {badge}
          </h2>
          <p className="mt-0.5 text-sm">
            {connected ? <span className="text-ok">● Connecté</span> : <span className="text-muted">Non connecté</span>}
          </p>
        </div>
        <div className="shrink-0">{action}</div>
      </div>
      <div className="mt-4 space-y-2 border-t border-line pt-4">{children}</div>
    </section>
  );
}
