name := "aurora-shell-devel"

# List the available Vagrant commands.
default:
    @just --list vagrant

# Boot and provision the development VM.
[no-cd]
create:
    @echo "Booting and provisioning Vagrant VM '{{ name }}'..."
    vagrant up

# Launch GNOME Shell inside the VM.
[no-cd]
run:
    bash scripts/run-vagrant-gnome-shell.sh

# Open an SSH session in the VM.
[no-cd]
ssh:
    vagrant ssh

# Destroy the development VM.
[no-cd]
remove:
    vagrant destroy -f
    @echo "Removed Vagrant VM '{{ name }}'."
