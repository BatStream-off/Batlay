/**
 * Logo Batlay : une chauve-souris avec une note de musique dans le torse.
 * `playing` fait battre les ailes (voir .bat-flap dans globals.css).
 * Couleur = currentColor ; la note est « gravée » via un masque, donc
 * transparente et non colorée en dur.
 */
const BAT_PATH = "M32 17 L34.6 8.4 L37.4 17.4 C42 15.2 54 11.5 62.5 16 Q59.5 22 60 30 Q56 27.4 53.6 34 Q49.6 29.4 46 35.4 Q43.6 32 40 38 L37.2 41 L35.4 48.5 L32 54 L28.6 48.5 L26.8 41 L24 38 Q20.4 32 18 35.4 Q14.4 29.4 10.4 34 Q8 27.4 4 30 Q4.5 22 1.5 16 C10 11.5 22 15.2 26.6 17.4 L29.4 8.4 L32 17Z";
const NOTE_PATH = "M31.2 37.6a2.7 2.2 0 1 1-2.6-2.2 2.7 2.2 0 0 1 2.6 2.2ZM31.2 37.6V26.2L36 28.6V31L32.7 29.4V37.6Z";

export function BatMark({ playing = false, className = "" }: { playing?: boolean; className?: string }) {
  return (
    <svg viewBox="0 0 64 64" className={`${className} ${playing ? "bat-flap" : ""}`} fill="currentColor" aria-hidden="true">
      <mask id="batlay-note-cut">
        <rect width="64" height="64" fill="#fff" />
        <path d={NOTE_PATH} fill="#000" />
      </mask>
      <path d={BAT_PATH} mask="url(#batlay-note-cut)" />
    </svg>
  );
}
