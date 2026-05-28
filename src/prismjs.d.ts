declare module "prismjs" {
  type PrismGrammar = Record<string, unknown>;

  interface PrismStatic {
    languages: Record<string, PrismGrammar | undefined>;
    highlight(text: string, grammar: PrismGrammar, language: string): string;
  }

  const Prism: PrismStatic;
  export default Prism;
}
