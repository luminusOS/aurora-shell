uuid := "aurora-shell@luminusos.github.io"
production_zip := "dist/target/" + uuid + ".shell-extension.zip"
development_zip := "dist/target/" + uuid + ".development.shell-extension.zip"

default:
    @just --list test

[no-cd]
unit:
    yarn test:unit

[no-cd]
coverage:
    yarn test:unit:coverage

[no-cd]
shell *targets:
    just package production
    scripts/run-shell-tests.sh --package {{ production_zip }} {{ targets }}

[no-cd]
dev:
    just package development
    AURORA_DEVTOOLS=1 scripts/run-shell-tests.sh \
        --package {{ development_zip }} \
        tests/shell/dev/devTool.test.js
