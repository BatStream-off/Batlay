/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./overlay.html", "./src/**/*.{ts,tsx}", "./overlay/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Palette Batlay : fond quasi-noir bleuté, accent "signal" violet/rose,
        // évite le vert acide / terracotta générique.
        base: {
          950: "#0A0A0F",
          900: "#111117",
          800: "#1A1A22",
          700: "#25252F",
          600: "#34343F",
        },
        signal: {
          400: "#B68CFF",
          500: "#9B6BFF",
          600: "#7C4DFF",
        },
        live: "#37E29A",
        muted: "#8A8A99",
      },
      fontFamily: {
        display: ["'Space Grotesk'", "system-ui", "sans-serif"],
        body: ["'Inter'", "system-ui", "sans-serif"],
        mono: ["'JetBrains Mono'", "monospace"],
      },
      borderRadius: {
        xl2: "1.25rem",
      },
      boxShadow: {
        glow: "0 0 24px -6px rgba(155, 107, 255, 0.45)",
      },
    },
  },
  plugins: [],
};
