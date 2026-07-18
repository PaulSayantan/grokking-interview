# Fonts

## SymbolsNerdFont-subset.woff2

A **subset** of [Symbols Nerd Font](https://www.nerdfonts.com/) (icons-only,
`NerdFontsSymbolsOnly`) containing only the handful of glyphs used by
`DomainCard.astro` for per-domain icons. The full font is ~2 MB; this subset is
under 1 KB, so it never regresses page-load (self-hosted, `font-display: swap`,
decorative-only — always paired with real text, so a font failure is harmless).

**Source:** `ryanoasis/nerd-fonts` release **v3.2.1**, asset
`NerdFontsSymbolsOnly` → `SymbolsNerdFont-Regular.ttf`.

**Regenerate** (requires `pip install fonttools brotli`):

```sh
python3 -m fontTools.subset SymbolsNerdFont-Regular.ttf \
  --unicodes=F1C0,F06C,F4D8,F0F4 \
  --flavor=woff2 --no-hinting --desubroutinize \
  --output-file=public/fonts/SymbolsNerdFont-subset.woff2
```

**Glyph map** — the `--unicodes` list MUST stay in sync with `domainIcon` in
`src/components/DomainCard.astro`:

| Domain | Glyph | Codepoint | CSS `content` |
|---|---|---|---|
| system-design | database (nf-fa-database) | U+F1C0 | `"\f1c0"` |
| spring-boot | leaf (nf-fa-leaf) | U+F06C | `"\f06c"` |
| spring-core | seedling (nf-fa-seedling) | U+F4D8 | `"\f4d8"` |
| java-jvm | coffee (nf-fa-coffee) | U+F0F4 | `"\f0f4"` |
