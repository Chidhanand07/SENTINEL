import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#0f0e0c",
        surface: "#1a1916",
        "surface-2": "#242220",
        "surface-3": "#2e2b28",
        accent: "#e8956d",
        "accent-2": "#c4a882",
        teal: "#7eb8a4",
        purple: "#9b8ec4",
        "text-1": "#f0ebe4",
        "text-2": "#a09890",
        "text-3": "#5c5650",
        border: "rgba(255,240,220,0.08)",
        green: "#7aab8a",
        red: "#c47a72",
        yellow: "#c4a84a",
      },
      fontFamily: {
        sans: ["Inter", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      fontSize: {
        "2xs": ["0.65rem", { lineHeight: "1rem" }],
      },
      borderRadius: {
        "2xl": "1rem",
        "3xl": "1.25rem",
      },
      animation: {
        "fade-in":    "fadeIn 0.25s ease both",
        "slide-up":   "slideUp 0.3s ease both",
        "fade-slide":  "fadeSlideIn 0.4s ease both",
        "pulse-dot":  "pulseDot 1s infinite",
        "glow-pulse": "glowPulse 2s infinite",
      },
      keyframes: {
        fadeIn:       { from: { opacity: "0" }, to: { opacity: "1" } },
        slideUp:      { from: { opacity: "0", transform: "translateY(8px)" }, to: { opacity: "1", transform: "none" } },
        fadeSlideIn:  { from: { opacity: "0", transform: "translateX(-8px)" }, to: { opacity: "1", transform: "translateX(0)" } },
        pulseDot:     { "0%,100%": { transform: "scale(1)", opacity: "1" }, "50%": { transform: "scale(1.6)", opacity: "0.4" } },
        glowPulse:    { "0%,100%": { boxShadow: "0 0 4px rgba(232,255,71,0.31)" }, "50%": { boxShadow: "0 0 14px rgba(232,255,71,0.67)" } },
      },
      boxShadow: {},
    },
  },
  plugins: [],
};
export default config;
