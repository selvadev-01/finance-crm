/** Vite's `?raw` import, used by tests to read a stylesheet as text. */
declare module "*.css?raw" {
  const content: string;
  export default content;
}
