import { useEffect, useState } from "react";
import { useMusicStore } from "@/stores/useMusicStore";
import { useToastStore } from "@/stores/useToastStore";
import { useSettingsStore } from "@/stores/useSettingsStore";

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

  // Applique la préférence persistée (Settings > lecteur système préféré)
  // au provider dès qu'elle est connue, pour qu'un "Connect" immédiat
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
      <h1 className="font-display text-2xl font-semibold text-white">Connections</h1>
      <p className="mt-1 text-sm text-muted">Choisissez la source musicale de vos overlays.</p>

      {error && (
        <div className="mt-4 rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-2.5 text-sm text-red-300">
          {error}
        </div>
      )}

      {/* --- Spotify --- */}
      <section className="mt-6 rounded-xl2 border border-base-800 bg-base-900 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium text-white">Spotify</h2>
            <p className="mt-0.5 text-sm text-muted">
              {activeProviderId === "spotify" ? (
                <span className="text-live">● Connected</span>
              ) : (
                "Not connected"
              )}
            </p>
          </div>
          {activeProviderId === "spotify" ? (
            <button
              onClick={() => disconnect()}
              className="rounded-lg border border-base-700 px-4 py-2 text-sm text-white hover:bg-base-800"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={handleSpotifyConnect}
              disabled={!spotifyConfigured || isConnecting}
              className="rounded-lg bg-signal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-signal-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isConnecting ? "Connexion..." : "Connect Spotify"}
            </button>
          )}
        </div>

        {!spotifyConfigured && (
          <div className="mt-4 space-y-2 border-t border-base-800 pt-4">
            <p className="text-xs text-muted">
              Configuration requise : créez une application sur le{" "}
              <span className="text-signal-400">Spotify Developer Dashboard</span>, ajoutez l'URI de
              redirection <code className="rounded bg-base-800 px-1 py-0.5">http://127.0.0.1:8945/callback</code>{" "}
              puis collez le Client ID ci-dessous.
            </p>
            <p className="text-xs text-muted">
              Le <strong>Client Secret n'est pas nécessaire</strong> (Batlay utilise le flow OAuth
              PKCE, prévu par Spotify pour les apps desktop où un secret ne peut pas être stocké en
              sécurité).
            </p>
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              ⚠️ Tant que votre app reste en <strong>Development Mode</strong> sur le dashboard
              Spotify, vous devez explicitement ajouter votre propre compte Spotify à la liste
              d'utilisateurs autorisés de l'app (Dashboard &gt; votre app &gt; Settings &gt; User
              Management), sinon l'écran d'autorisation refusera la connexion. Depuis 2026, un
              compte Spotify Premium est aussi requis pour utiliser une app en Development Mode.
            </p>
            <div className="flex gap-2">
              <input
                value={clientId}
                onChange={(e) => setClientId(e.target.value)}
                placeholder="Spotify Client ID"
                className="flex-1 rounded-lg border border-base-700 bg-base-800 px-3 py-2 text-sm text-white outline-none focus:border-signal-500"
              />
              <button
                onClick={saveClientId}
                className="rounded-lg border border-base-700 px-4 py-2 text-sm text-white hover:bg-base-800"
              >
                Save
              </button>
            </div>
          </div>
        )}
      </section>

      {/* --- Lecture système (Windows) --- */}
      <section className="mt-4 rounded-xl2 border border-base-800 bg-base-900 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium text-white">Lecture système (Windows)</h2>
            <p className="mt-0.5 text-sm text-muted">
              {activeProviderId === "system-media" ? (
                <span className="text-live">● Connected</span>
              ) : (
                "Not connected"
              )}
            </p>
          </div>
          {activeProviderId === "system-media" ? (
            <button
              onClick={() => disconnect()}
              className="rounded-lg border border-base-700 px-4 py-2 text-sm text-white hover:bg-base-800"
            >
              Disconnect
            </button>
          ) : (
            <button
              onClick={handleSystemMediaConnect}
              disabled={!systemMediaSupported || isConnecting}
              className="rounded-lg bg-signal-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-signal-500 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isConnecting ? "Connexion..." : "Connect"}
            </button>
          )}
        </div>

        <div className="mt-4 space-y-2 border-t border-base-800 pt-4">
          <p className="text-xs text-muted">
            Aucun compte, aucun Client ID, aucun abonnement <strong>Premium</strong> requis : ce
            mode lit directement les informations "En cours de lecture" exposées par Windows (les
            mêmes que le Volet de contrôle multimédia / les touches multimédias du clavier). Il
            fonctionne avec Spotify Free, un navigateur, VLC, etc.
          </p>
          {!systemMediaSupported && (
            <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
              ⚠️ Non disponible sur cette plateforme (nécessite Windows 10 1809+ ou Windows 11).
            </p>
          )}
          {systemMediaSupported && (
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs font-medium text-muted">
                  Lecteur à suivre {sessions.length > 1 && "(plusieurs détectés)"}
                </label>
                <button
                  onClick={() => void refreshSessions()}
                  disabled={loadingSessions}
                  className="text-xs text-signal-400 hover:text-signal-300 disabled:opacity-40"
                >
                  {loadingSessions ? "Recherche..." : "Rafraîchir"}
                </button>
              </div>
              <select
                value={settings?.preferredSystemMediaAppId ?? ""}
                onChange={(e) => void handleSelectSession(e.target.value)}
                className="w-full rounded-lg border border-base-700 bg-base-800 px-3 py-2 text-sm text-white outline-none focus:border-signal-500"
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
                <p className="text-xs text-base-600">
                  Aucun lecteur actif détecté pour le moment. Lancez une lecture puis cliquez sur
                  "Rafraîchir".
                </p>
              )}
            </div>
          )}
        </div>
      </section>

      {/* --- Demo Mode --- */}
      <section className="mt-4 rounded-xl2 border border-base-800 bg-base-900 p-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-medium text-white">Demo Mode</h2>
            <p className="mt-0.5 text-sm text-muted">
              Testez Batlay sans Spotify avec des morceaux d'exemple.
            </p>
          </div>
          {activeProviderId === "demo" ? (
            <button
              onClick={() => disconnect()}
              className="rounded-lg border border-base-700 px-4 py-2 text-sm text-white hover:bg-base-800"
            >
              Stop Demo
            </button>
          ) : (
            <button
              onClick={() => connectDemo()}
              disabled={isConnecting}
              className="rounded-lg border border-base-700 px-4 py-2 text-sm text-white hover:bg-base-800"
            >
              Start Demo
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
