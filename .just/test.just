uuid := "aurora-shell@luminusos.github.io"
production_zip := "dist/target/" + uuid + ".shell-extension.zip"
development_zip := "dist/target/" + uuid + ".development.shell-extension.zip"

# List the available test commands.
default:
    @just --list test

# Run unit tests.
[no-cd]
unit:
    yarn test:unit

# Run unit tests with coverage.
[no-cd]
coverage:
    yarn test:unit:coverage

# Run one GNOME Shell integration test.
[no-cd]
shell script:
    just package production
    bash scripts/run-shell-tests.sh {{ production_zip }} {{ script }}

# Run every production GNOME Shell integration test.
[no-cd]
all:
    just package production
    bash scripts/run-shell-tests.sh {{ production_zip }}

# Run the DevTool integration test.
[no-cd]
dev:
    just package development
    AURORA_DEVTOOLS=1 bash scripts/run-shell-tests.sh \
        {{ development_zip }} \
        tests/shell/auroraDevTool.js
