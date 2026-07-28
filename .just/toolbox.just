toolbox_name := env_var_or_default("AURORA_TOOLBOX_NAME", "aurora-shell-devel")
uuid := "aurora-shell@luminusos.github.io"
production_zip := "dist/target/" + uuid + ".shell-extension.zip"
development_zip := "dist/target/" + uuid + ".development.shell-extension.zip"

# List the available toolbox commands.
default:
    @just --list toolbox

# Create the Fedora development toolbox.
[no-cd]
create:
    #!/usr/bin/env bash
    set -e
    if [ -n "${AURORA_TOOLBOX_IMAGE:-}" ]; then
        image="$AURORA_TOOLBOX_IMAGE"
    else
        image="$(bash scripts/ci-image-name.sh)"
        podman build -f Containerfile -t "$image" .
    fi

    echo "Creating toolbox '{{ toolbox_name }}' from '$image'..."
    toolbox create --image "$image" {{ toolbox_name }}

# Launch GNOME Shell inside the toolbox.
[no-cd]
run:
    bash scripts/run-gnome-shell.sh {{ toolbox_name }}

# Remove the development toolbox.
[no-cd]
remove:
    toolbox rm --force {{ toolbox_name }}
    @echo "Removed toolbox '{{ toolbox_name }}'."

# Run a test inside the toolbox: `test <script>`, `test all`, or `test dev`.
[no-cd]
test target:
    #!/usr/bin/env bash
    set -e
    project="$(pwd -P)"

    case "{{ target }}" in
        all)
            just package production
            toolbox --container {{ toolbox_name }} run \
                bash "$project/scripts/run-shell-tests.sh" \
                "$project/{{ production_zip }}"
            ;;
        dev)
            just package development
            toolbox --container {{ toolbox_name }} run \
                env AURORA_DEVTOOLS=1 \
                bash "$project/scripts/run-shell-tests.sh" \
                "$project/{{ development_zip }}" \
                "$project/tests/shell/auroraDevTool.js"
            ;;
        *)
            just package production
            toolbox --container {{ toolbox_name }} run \
                bash "$project/scripts/run-shell-tests.sh" \
                "$project/{{ production_zip }}" \
                "$project/{{ target }}"
            ;;
    esac
