toolbox_name := env_var_or_default("AURORA_TOOLBOX_NAME", "aurora-shell-devel")

default:
    @just --list toolbox

[no-cd]
create:
    scripts/create-toolbox.sh

[no-cd]
run:
    scripts/run-gnome-shell.sh --toolbox {{ toolbox_name }}

[no-cd]
remove:
    toolbox rm --force {{ toolbox_name }}

[no-cd]
test *targets:
    scripts/run-toolbox-tests.sh {{ targets }}

[no-cd]
test-dev:
    scripts/run-toolbox-tests.sh --dev
