import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        heading: ['JetBrains Mono', 'monospace'],
        mono: ['JetBrains Mono', 'monospace'],
        body: ['Inter', 'sans-serif'],
      },
      colors: {
        // Existing blue utilities keep their exact original colors outside the
        // neutral research workspace. Values are inherited, so shared feed
        // components do not need different class names or presentation logic.
        blue: {
          50: "rgb(var(--terminal-blue-50, 239 246 255) / <alpha-value>)",
          100: "rgb(var(--terminal-blue-100, 219 234 254) / <alpha-value>)",
          200: "rgb(var(--terminal-blue-200, 191 219 254) / <alpha-value>)",
          300: "rgb(var(--terminal-blue-300, 147 197 253) / <alpha-value>)",
          400: "rgb(var(--terminal-blue-400, 96 165 250) / <alpha-value>)",
          500: "rgb(var(--terminal-blue-500, 59 130 246) / <alpha-value>)",
          600: "rgb(var(--terminal-blue-600, 37 99 235) / <alpha-value>)",
          700: "rgb(var(--terminal-blue-700, 29 78 216) / <alpha-value>)",
          800: "rgb(var(--terminal-blue-800, 30 64 175) / <alpha-value>)",
          900: "rgb(var(--terminal-blue-900, 30 58 138) / <alpha-value>)",
          950: "rgb(var(--terminal-blue-950, 23 37 84) / <alpha-value>)",
        },
        slate: {
          800: "rgb(var(--terminal-slate-800, 30 41 59) / <alpha-value>)",
          900: "rgb(var(--terminal-slate-900, 15 23 42) / <alpha-value>)",
          950: "rgb(var(--terminal-slate-950, 2 6 23) / <alpha-value>)",
        },
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        "section-heading": "hsl(var(--section-heading))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
