import { useEffect, useState } from "react";
import { Routes, Route, useLocation } from "react-router-dom";
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
  const { pathname } = useLocation();
  const inEditor = pathname.startsWith("/editor");
  // Dans l'éditeur la barre latérale se réduit à des icônes (la fenêtre fait
  // 1024 px au minimum : sans ça, il ne resterait qu'un canvas minuscule entre
  // les deux panneaux). L'utilisateur peut la rouvrir ; on l'oublie en sortant.
  const [editorSidebarOpen, setEditorSidebarOpen] = useState(false);

  useEffect(() => {
    // Étape 3 du démarrage de Batlay : charger les données sauvegardées
    // et restaurer l'état de connexion lorsque c'est possible.
    loadOverlays();
    loadSettings();
    tryRestoreSpotify();
  }, [loadOverlays, loadSettings, tryRestoreSpotify]);

  useEffect(() => {
    if (!inEditor) setEditorSidebarOpen(false);
  }, [inEditor]);

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-base-950">
      <Sidebar
        compact={inEditor && !editorSidebarOpen}
        onToggleCompact={inEditor ? () => setEditorSidebarOpen((open) => !open) : undefined}
      />
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
