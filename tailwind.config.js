/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "#1e1e1e",
        panel: "#252526",
        "panel-alt": "#2d2d2d",
        "panel-hover": "#2a2d2e",
        selection: "#37373d",
        input: "#3c3c3c",
        border: "#333333",
        "border-subtle": "#1e1e1e",
        text: {
          primary: "#cccccc",
          muted: "#969696",
          subtle: "#666666",
          faint: "#555555",
        },
        accent: {
          blue: "#519aba",
          focus: "#007acc",
          warn: "#dcb67a",
        },
      },
    },
  },
  plugins: [],
};
