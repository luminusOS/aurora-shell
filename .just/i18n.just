default:
    @just --list i18n

[no-cd]
pot:
    scripts/i18n.sh pot

[no-cd]
update:
    scripts/i18n.sh update

[no-cd]
compile:
    scripts/i18n.sh compile
