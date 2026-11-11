ARG FEDORA_VERSION=45

FROM registry.fedoraproject.org/fedora-toolbox:${FEDORA_VERSION}

ARG COREPACK_VERSION=0.34.6

LABEL org.opencontainers.image.source="https://github.com/luminusOS/aurora-shell"
LABEL org.opencontainers.image.description="Aurora Shell build and GNOME integration test environment"

ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    COREPACK_HOME=/opt/corepack \
    YARN_GLOBAL_FOLDER=/opt/yarn-cache

# The integration tests must run against a stable GNOME Shell. This image is built once per
# Containerfile hash, so an unconstrained install stayed on 51~rc, whose cursor tracker never
# prepares a cursor while the pointer is hidden. RPM sorts a "~rc" version below the release, so
# the constraint makes a stale pre-release fail the build instead of being tested against.
RUN dnf install -y --quiet --setopt=install_weak_deps=False \
        dbus-daemon \
        gettext \
        git \
        'gnome-shell >= 51.0' \
        gsettings-desktop-schemas \
        just \
        mesa-dri-drivers \
        'mutter-devkit >= 51.0' \
        nodejs \
        npm \
        python3-dbusmock \
        which \
        xeyes \
        zip \
    && dnf clean all \
    && rm -rf /var/cache/dnf

RUN npm install --global "corepack@${COREPACK_VERSION}" \
    && corepack enable \
    && install -d -m 0777 "$COREPACK_HOME" \
    && install -d -m 0777 "$YARN_GLOBAL_FOLDER"

WORKDIR /opt/aurora-shell-dependencies

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases/ .yarn/releases/

# Keep dependency archives in the image so CI only has to materialize
# node_modules for the checked-out revision. A PR with a newer lockfile can
# still download missing archives normally.
RUN corepack install --global "$(node -p "require('./package.json').packageManager")" \
    && yarn install --immutable \
    && rm -rf node_modules \
    && chmod -R a+rwX "$COREPACK_HOME" \
    && chmod -R a+rwX "$YARN_GLOBAL_FOLDER"

WORKDIR /workspace

CMD ["/bin/bash"]
