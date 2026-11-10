# Development workflow

## How the themes are connected

| Shopify theme | Git branch | Notes |
|---|---|---|
| `luuna-2026/main` (live, #188745875609) | `main` | Client edits in the theme editor are auto-committed to `main` as "Update from Shopify for theme luuna-2026/main". |
| `luuna-2026/development` | `development` | Pushing `development` updates the dev theme. Editor changes on the dev theme are committed back to `development`. |

`main` on GitHub always matches live, so `git pull origin main` is the way to get the client's latest. Don't use `shopify theme pull` for this.

## Starting a feature

```
git checkout development
git pull origin development
git pull origin main
git push origin development
```

## While you're working

Merge live in at least daily, and always before shipping:

```
git fetch origin
git merge origin/main
```

Run `git pull origin development` before working locally, in case anyone edited the dev theme in the editor.

## Shipping

```
git fetch origin
git merge origin/main        # get the client's latest changes right before release
git push origin development  # check the dev theme
```

Then merge `development` into `main`, directly or with a PR. Live updates automatically.

## Resolving conflicts

The client can only change JSON through the theme editor:

- `templates/*.json`
- `sections/*-group.json`
- `config/settings_data.json`
- `locales/*.json`

`.liquid`, CSS and JS files will rarely conflict. When a JSON file does conflict:

- **Content and settings** (text, colours, toggles, block order): keep the client's version from `main`.
- **Structural changes** (new sections or blocks your feature adds): re-apply them on top of the client's version.

## Habits

- **Give new settings defaults in the `{% schema %}`.** Then your feature doesn't depend on `settings_data.json` changes, which can overwrite the client's settings.
- **Keep content edits in the live editor.** If content needs to change on live mid-feature, change it in the live theme editor rather than in your branch. The next `git merge origin/main` will pick it up.
- **Label commits accurately.** Only call a commit "Sync from live" if the changes came from `origin/main`.
