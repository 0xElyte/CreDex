import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ["Bebas Neue", "Arial Black", "sans-serif"],
        mono: ["DM Mono", "Courier New", "monospace"],
        body: ["Plus Jakarta Sans", "sans-serif"],
      },
      colors: {
        surface: "#0c0c0c",
        "surface-2": "#111111",
        "surface-3": "#161616",
        "surface-4": "#1c1c1c",
      },
      animation: {
        "pulse-dot": "pulse-dot 2s infinite",
        "ring-spin": "ring-spin linear infinite",
        "ticker": "ticker 28s linear infinite",
        "slide-up": "slide-up .5s ease forwards",
        "progress-flash": "progress-flash 1.5s ease-in-out infinite",
        "toast-in": "toast-in 0.3s ease forwards",
      },
    },
  },
  plugins: [],
};

export default config;
