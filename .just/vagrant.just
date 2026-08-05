name := "aurora-shell-devel"

default:
    @just --list vagrant

[no-cd]
create:
    @echo "Booting and provisioning Vagrant VM '{{ name }}'..."
    vagrant up

[no-cd]
run:
    bash scripts/run-vagrant-gnome-shell.sh

[no-cd]
ssh:
    vagrant ssh

[no-cd]
remove:
    vagrant destroy -f
    @echo "Removed Vagrant VM '{{ name }}'."
