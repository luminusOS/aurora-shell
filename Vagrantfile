# -*- mode: ruby -*-
# vi: set ft=ruby :

# Aurora Shell – Vagrant-based GNOME Shell devkit environment.
# Mirrors the Podman toolbox workflow (`just toolbox *`).
#
# Requirements (host):
#   - Vagrant ≥ 2.3
#   - vagrant-libvirt plugin
#
# Quick start:
#   just vagrant create   # boot + provision
#   just vagrant run      # build, install & launch gnome-shell --devkit
#   just vagrant ssh      # interactive shell inside VM
#   just vagrant remove   # destroy VM

VAGRANTFILE_API_VERSION = "2"

VM_NAME         = "aurora-shell-devel"
BOX             = "generic/arch"
BOX_VERSION     = "4.3.12"
CPUS            = 2
MEMORY_MB       = 2048

PACKAGES = %w[
  gnome-shell
  dbus
  mesa
  gnome-keyring
  xdg-desktop-portal-gnome
  nodejs
  npm
  rsync
  git
  just
  zip
].freeze

Vagrant.configure(VAGRANTFILE_API_VERSION) do |config|
  config.vm.box         = BOX
  config.vm.box_version = BOX_VERSION
  config.vm.hostname    = VM_NAME
  config.vm.boot_timeout = 600

  # ----------------------------------------------------------
  # Provider: libvirt (QEMU/KVM)
  # Requires: vagrant plugin install vagrant-libvirt
  # ----------------------------------------------------------
  config.vm.provider :libvirt do |lv|
    lv.driver        = "kvm"
    lv.memory        = MEMORY_MB
    lv.cpus          = CPUS
    lv.video_vram    = 64
    lv.machine_type  = "virt" if `uname -m`.strip == "aarch64"
    lv.graphics_type = "spice"
    lv.channel :type => "spicevmc", :target_name => "com.redhat.spice.0", :target_type => "virtio"
  end

  # ----------------------------------------------------------
  # Synced folder: project root → /home/vagrant/aurora-shell
  # ----------------------------------------------------------
  config.vm.synced_folder ".", "/home/vagrant/aurora-shell",
    type: "rsync",
    rsync__exclude: [
      ".git/",
      ".vagrant/",
      "node_modules/",
      "dist/",
    ],
    rsync__args: ["--verbose", "--archive", "--delete", "--compress"]

  # ----------------------------------------------------------
  # Provision: install system packages + Yarn 4
  # ----------------------------------------------------------
  config.vm.provision "shell", privileged: true, inline: <<~SHELL
    set -e

    echo "==> Refreshing package databases and keyring..."
    echo 'Server = https://geo.mirror.pkgbuild.com/$repo/os/$arch' > /etc/pacman.d/mirrorlist
    pacman -Sy --noconfirm archlinux-keyring
    pacman-key --populate archlinux

    echo "==> Updating system packages..."
    pacman -Su --noconfirm

    echo "==> Installing required packages..."
    pacman -S --noconfirm #{PACKAGES.join(" ")}

    echo "==> Installing and enabling Yarn via corepack..."
    npm install -g corepack
    corepack enable

    echo "==> Provisioning complete."
  SHELL

  # ----------------------------------------------------------
  # Provision (user-level): prepare Yarn + build extension
  # ----------------------------------------------------------
  config.vm.provision "shell", privileged: false, inline: <<~SHELL
    set -e
    cd /home/vagrant/aurora-shell

    echo "==> Preparing Yarn via corepack..."
    corepack prepare --activate 2>/dev/null || true

    echo "==> Installing Node dependencies..."
    yarn install --immutable 2>/dev/null || yarn install

    echo "==> Building extension..."
    just build

    echo "==> Installing extension..."
    just install

    echo ""
    echo "Aurora Shell is ready inside the VM."
    echo "Run 'just vagrant run' to launch gnome-shell --devkit."
  SHELL
end
