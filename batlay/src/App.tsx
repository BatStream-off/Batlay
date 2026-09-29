import { useEffect } from "react";
import { Routes, Route } from "react-router-dom";
import { Sidebar } from "@/layouts/Sidebar";
import { ToastHost } from "@/components/ToastHost";
import { Dashboard } from "@/pages/Dashboard";
import { Overlays } from "@/pages/Overlays";
import { Editor } from "@/pages/Editor";
import { Connections } from "@/pages/Connections";
import { Settings } from "@/pages/Settings";
import { useOverlayStore } from "@/stores/useOverlayStore";
import { useSettingsStore } from "@/stores/useSettingsStore";
import { useMusicStore } from "@/stores/useMusicStore";

export default function App() {
  const loadOverlays = useOverlayStore((s) => s.load);
  const loadSettings = useSettingsStore((s) => s.load);
  const tryRestoreSpotify = useMusicStore((s) => s.tryRestoreSpotifySession);

  useEffect(() => {
    // Étape 3 du démarrage de Batlay : charger les données sauvegardées
    // et restaurer l'état de connexion lorsque c'est possible.
    loadOverlays();
    loadSettings();
    tryRestoreSpotify();
  }, [loadOverlays, loadSettings, tryRestoreSpotify]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base-950">
      <Sidebar />
      <main className="flex-1 overflow-y-auto">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/overlays" element={<Overlays />} />
          <Route path="/editor/:overlayId" element={<Editor />} />
          <Route path="/connections" element={<Connections />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </main>
      <ToastHost />
    </div>
  );
}
