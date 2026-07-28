# List the available translation commands.
default:
    @just --list translation

# Regenerate the POT template.
[no-cd]
pot:
    #!/usr/bin/env bash
    set -e
    just build
    mapfile -t javascript_files < <(find dist -name '*.js' | sort)

    xgettext \
        --from-code=UTF-8 \
        --language=JavaScript \
        --keyword=_ \
        --keyword=ngettext:1,2 \
        --keyword=pgettext:1c,2 \
        --package-name=aurora-shell \
        --msgid-bugs-address=https://github.com/luminusOS/aurora-shell/issues \
        --output=dist/aurora-shell@luminusos.github.io.pot \
        "${javascript_files[@]}"

    echo "POT template regenerated."

# Merge the current POT template into every PO catalog.
[no-cd]
update: pot
    #!/usr/bin/env bash
    set -e
    for catalog in data/po/*.po; do
        echo "Merging $catalog..."
        msgmerge \
            --update \
            --backup=none \
            "$catalog" \
            dist/aurora-shell@luminusos.github.io.pot
    done

    echo "Translation catalogs updated."

# Compile every PO catalog into dist.
[no-cd]
compile:
    #!/usr/bin/env bash
    set -e
    domain="aurora-shell@luminusos.github.io"

    for catalog in data/po/*.po; do
        [ -f "$catalog" ] || continue
        language="$(basename "$catalog" .po)"
        output="dist/locale/$language/LC_MESSAGES/$domain.mo"
        mkdir -p "$(dirname "$output")"
        msgfmt --output-file="$output" "$catalog"
        echo "Compiled $catalog -> $output"
    done
