import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "rgb(var(--color-ink-rgb) / <alpha-value>)",
        paper: "rgb(var(--color-paper-rgb) / <alpha-value>)",
        card: "rgb(var(--color-card-rgb) / <alpha-value>)",
        sand: "rgb(var(--color-sand-rgb) / <alpha-value>)",
        surface: "rgb(var(--color-surface-rgb) / <alpha-value>)",
        border: "rgb(var(--color-border-rgb) / <alpha-value>)",
        "directory-divider": "rgb(var(--color-directory-divider-rgb) / <alpha-value>)",
        "control-border": "rgb(var(--color-control-border-rgb) / <alpha-value>)",
        cyan: "rgb(var(--color-cyan-rgb) / <alpha-value>)",
        violet: "rgb(var(--color-violet-rgb) / <alpha-value>)",
        "warm-accent": "rgb(var(--color-warm-accent-rgb) / <alpha-value>)",
        "muted-foreground": "rgb(var(--color-muted-rgb) / <alpha-value>)",
        brand: {
          50: "rgb(var(--color-brand-50) / <alpha-value>)",
          100: "rgb(var(--color-brand-100) / <alpha-value>)",
          200: "rgb(var(--color-brand-200) / <alpha-value>)",
          300: "rgb(var(--color-brand-300) / <alpha-value>)",
          400: "rgb(var(--color-brand-400) / <alpha-value>)",
          500: "rgb(var(--color-brand-500) / <alpha-value>)",
          600: "rgb(var(--color-brand-600) / <alpha-value>)",
          700: "rgb(var(--color-brand-700) / <alpha-value>)",
          800: "rgb(var(--color-brand-800) / <alpha-value>)",
          900: "rgb(var(--color-brand-900) / <alpha-value>)"
        },
        success: {
          50: "rgb(var(--color-success-50) / <alpha-value>)",
          200: "rgb(var(--color-success-200) / <alpha-value>)",
          500: "rgb(var(--color-success-500) / <alpha-value>)",
          700: "rgb(var(--color-success-700) / <alpha-value>)"
        },
        warning: {
          50: "rgb(var(--color-warning-50) / <alpha-value>)",
          200: "rgb(var(--color-warning-200) / <alpha-value>)",
          500: "rgb(var(--color-warning-500) / <alpha-value>)",
          700: "rgb(var(--color-warning-700) / <alpha-value>)"
        },
        error: {
          50: "rgb(var(--color-error-50) / <alpha-value>)",
          200: "rgb(var(--color-error-200) / <alpha-value>)",
          500: "rgb(var(--color-error-500) / <alpha-value>)",
          700: "rgb(var(--color-error-700) / <alpha-value>)"
        }
      },
      fontFamily: {
        sans: ["Arial", "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", "sans-serif"],
        serif: ["Noto Serif SC", "Songti SC", "STSong", "serif"]
      },
      borderRadius: {
        button: "13px",
        card: "16px",
        field: "14px"
      },
      boxShadow: {
        soft: "0 14px 36px rgba(49, 46, 129, 0.10)",
        lift: "0 22px 58px rgba(49, 46, 129, 0.16)",
        glow: "0 14px 42px rgba(99, 102, 241, 0.16)",
        action: "0 14px 34px rgba(67, 56, 202, 0.26)"
      },
      backgroundImage: {
        "lele-portrait": "radial-gradient(circle at 50% 25%, rgb(var(--color-brand-50)) 0%, #FFFFFF 68%)",
        "orbit-gradient": "linear-gradient(135deg, #3730A3 0%, #4338CA 32%, #6366F1 61%, #06B6D4 100%)",
        "brand-gradient": "linear-gradient(135deg, #3730A3 0%, #4338CA 100%)",
        "title-gradient": "linear-gradient(100deg, #3730A3 0%, #6366F1 100%)"
      },
      keyframes: {
        "orbit-drift": {
          "0%, 100%": { transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)" },
          "50%": { transform: "translate3d(8px, -6px, 0) rotate(2deg) scale(1.012)" }
        },
        "orbit-drift-reverse": {
          "0%, 100%": { transform: "translate3d(0, 0, 0) rotate(0deg) scale(1)" },
          "50%": { transform: "translate3d(-7px, 7px, 0) rotate(-2deg) scale(0.99)" }
        },
        "star-breathe": {
          "0%, 100%": { opacity: "0.38" },
          "50%": { opacity: "1" }
        },
        "message-enter": {
          from: { opacity: "0", transform: "translate3d(0, 8px, 0)" },
          to: { opacity: "1", transform: "translate3d(0, 0, 0)" }
        }
      },
      animation: {
        "orbit-drift": "orbit-drift 22s ease-in-out infinite",
        "orbit-drift-reverse": "orbit-drift-reverse 19s ease-in-out infinite",
        "star-breathe": "star-breathe 4.8s ease-in-out infinite",
        "message-enter": "message-enter 220ms ease-out both"
      }
    }
  },
  plugins: []
};

export default config;
