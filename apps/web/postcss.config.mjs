// Tailwind v4 uses a dedicated PostCSS plugin package. Using `tailwindcss`
// directly here is the v3 arrangement and fails with a confusing error.
export default {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};
