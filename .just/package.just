default: production

[no-cd]
production:
    scripts/package-extension.sh production

[no-cd]
development:
    scripts/package-extension.sh development

[no-cd]
check:
    scripts/package-extension.sh check
