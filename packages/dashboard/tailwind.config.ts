import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"] ,
  theme: {
    extend: {
      colors: {
        "cf-bg": "#0d0d0f",
        "cf-panel": "#161618",
        "cf-border": "#232327",
        "cf-accent": "#f97316",
        "cf-green": "#22c55e",
        "cf-red": "#ef4444",
        "cf-yellow": "#eab308",
        "cf-blue": "#38bdf8",
        "cf-purple": "#a855f7",
        "cf-cyan": "#06b6d4",
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "-apple-system", "BlinkMacSystemFont", "Segoe UI", "sans-serif"],
        mono: ["JetBrains Mono", "SFMono-Regular", "Menlo", "monospace"],
      },
      boxShadow: {
        card: "0 10px 40px rgba(0, 0, 0, 0.45)",
      },
    },
  },
  plugins: [],
};

export default config;
