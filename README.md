# Sanket More: DevOps guides

Source for [erom-teknas.github.io](https://erom-teknas.github.io): hands-on guides to AWS,
Kubernetes, Terraform and CI/CD, plus a few side projects.

It is a [Jekyll](https://jekyllrb.com) site with its own theme, deployed to GitHub Pages by
`.github/workflows/pages-deploy.yml` on every push to `main`.

## Writing

- Posts live in `_posts/` as Markdown. Front matter needs `title`, `date`, `categories`
  (the first one is the topic) and `tags`.
- Paired light and dark screenshots: add `{: .light }` and `{: .dark }` after each image.
- Callouts: put `{: .prompt-tip }` (or `info`, `warning`, `danger`) after a blockquote.
- Side projects are listed in `_data/projects.yml`.

## Running locally

```console
$ bundle install
$ bundle exec jekyll serve
```

The site's scripts are prebuilt into `assets/js/dist/`, so the above is all you need to write
and preview posts. To change the scripts in `_js/` or the icons, rebuild them and commit the
output:

```console
$ npm install
$ npm run build
```

## How it is put together

| Path | What it is |
| --- | --- |
| `_layouts/`, `_includes/` | Page templates |
| `_sass/` | Styles; colour tokens for both themes are in `_sass/_tokens.scss` |
| `_js/` | Scripts: search palette, theme switch, article tools, and the home page's 3D topology (Three.js) and scroll motion (GSAP) |
| `tools/` | Build scripts for the JS bundle and the icon sprite |

Fonts: [Geist and Geist Mono](https://vercel.com/font) (SIL Open Font License).
Icons: [Phosphor](https://phosphoricons.com) (MIT).

## License

Code: see `LICENSE`. Posts are licensed under
[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).
