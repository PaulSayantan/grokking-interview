/** @type {import('tailwindcss').Config} */
export default {
  content: ["./src/**/*.{astro,html,js,jsx,ts,tsx,md,mdx}"],
  // Dark mode is driven by a `data-theme="dark"` attribute on <html>, set by the
  // no-flash inline script in BaseLayout. This lets the toggle override the OS
  // preference while still honoring prefers-color-scheme on first paint.
  darkMode: ["selector", '[data-theme="dark"]'],
  theme: {
    extend: {
      // Semantic tokens mapped to the OKLCH CSS custom properties in
      // global.css, so agents can use `bg-primary`, `text-muted`,
      // `border-app`, `text-group-core`, etc. These do NOT replace the
      // existing inline `style="color: var(--color-*)"` usage — both work.
      colors: {
        bg: "var(--color-bg)",
        surface: "var(--color-surface)",
        "surface-2": "var(--color-surface-2)",
        app: "var(--color-border)", // border-app (avoid clobbering `border`)
        text: "var(--color-text)",
        muted: "var(--color-text-muted)",
        primary: "var(--color-primary)",
        "primary-hover": "var(--color-primary-hover)",
        "primary-contrast": "var(--color-primary-contrast)",
        accent: "var(--color-accent)",
        correct: "var(--color-correct)",
        incorrect: "var(--color-incorrect)",
        "group-core": "var(--color-group-core)",
        "group-advanced": "var(--color-group-advanced)",
        "group-aws": "var(--color-group-aws)",
        // FutureAGI-style accent palette
        "accent-orange": "var(--accent-orange)",
        "accent-purple": "var(--accent-purple)",
        "accent-blue": "var(--accent-blue)",
        "accent-green": "var(--accent-green)",
        "accent-red": "var(--accent-red)",
        "accent-pink": "var(--accent-pink)",
        "accent-amber": "var(--accent-amber)",
        "accent-teal": "var(--accent-teal)",
      },
      borderColor: {
        app: "var(--color-border)",
        DEFAULT: "var(--color-border)",
      },
      boxShadow: {
        1: "var(--shadow-1)",
        2: "var(--shadow-2)",
        3: "var(--shadow-3)",
        glow: "var(--shadow-glow)",
      },
      borderRadius: {
        xl: "var(--radius-xl)",
      },
      fontSize: {
        "step--1": "var(--step--1)",
        "step-0": "var(--step-0)",
        "step-1": "var(--step-1)",
        "step-2": "var(--step-2)",
        "step-3": "var(--step-3)",
        "step-4": "var(--step-4)",
        "step-5": "var(--step-5)",
        "step-6": "var(--step-6)",
      },
      fontFamily: {
        sans: [
          "Inter Variable",
          "Inter",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: [
          "JetBrains Mono Variable",
          "JetBrains Mono",
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Monaco",
          "Consolas",
          "monospace",
        ],
      },
      maxWidth: {
        prose: "68ch",
        "prose-wide": "80ch",
        "prose-narrow": "60ch",
      },
    },
  },
  plugins: [],
};
