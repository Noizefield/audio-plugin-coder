# APC dev container: Ubuntu 24.04 LTS + everything `apc doctor` checks for on Linux.
#
# Build is driven by .devcontainer/devcontainer.json (context = repo root).
# Standalone: docker build -f .devcontainer/Dockerfile -t apc-dev .
#
# What is NOT baked in (kept out of the image on purpose):
#   - JUCE: pinned in apc.config.json (juce.pin). It lives in the workspace under
#     _tools/JUCE and is fetched on first start by scripts/lib/juce-shallow-clone.sh,
#     so a pin bump never needs an image rebuild.
#   - DAW hosts / audio hardware: this image builds and validates plugins headless.
FROM ubuntu:24.04

ARG DEBIAN_FRONTEND=noninteractive
# Node LTS major (NodeSource). APC requires Node >= 18; use the current LTS.
ARG NODE_MAJOR=24
# pluginval: set PLUGINVAL_URL="" to skip. Tracktion publishes a Linux zip per release.
ARG PLUGINVAL_URL=https://github.com/Tracktion/pluginval/releases/latest/download/pluginval_Linux.zip

# Toolchain + JUCE 9 Linux dependencies (+ WebView: webkit2gtk-4.1) + headless GUI (xvfb)
RUN apt-get update && apt-get install -y --no-install-recommends \
        ca-certificates curl gnupg git unzip jq python3 pkg-config sudo \
        build-essential cmake ninja-build \
        libasound2-dev libjack-jackd2-dev ladspa-sdk \
        libx11-dev libxext-dev libxrandr-dev libxinerama-dev libxcursor-dev libxcomposite-dev libxrender-dev \
        libfreetype-dev libfontconfig1-dev \
        libgl1-mesa-dev libglu1-mesa-dev mesa-common-dev libegl-dev \
        libwebkit2gtk-4.1-dev libcurl4-openssl-dev \
        xvfb xauth \
    && rm -rf /var/lib/apt/lists/*

# Node.js LTS from the NodeSource apt repository (signed keyring, no curl|bash).
RUN mkdir -p /etc/apt/keyrings \
    && curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg \
    && echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_${NODE_MAJOR}.x nodistro main" > /etc/apt/sources.list.d/nodesource.list \
    && apt-get update && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# pluginval (VST3 validator). Non-fatal: if the download fails the image still builds and
# `apc doctor` / the test phase report pluginval as missing. Installed on PATH because the
# workspace mount hides anything baked into /workspaces/*.
RUN if [ -n "${PLUGINVAL_URL}" ]; then \
        curl -fsSL "${PLUGINVAL_URL}" -o /tmp/pluginval.zip \
        && unzip -q /tmp/pluginval.zip -d /tmp/pluginval \
        && install -m 0755 /tmp/pluginval/pluginval /usr/local/bin/pluginval \
        && rm -rf /tmp/pluginval /tmp/pluginval.zip \
        || echo "WARN: pluginval download failed; continuing without it"; \
    fi

# Non-root user with passwordless sudo (the ubuntu:24.04 image already ships user 'ubuntu', uid 1000).
RUN echo "ubuntu ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/ubuntu && chmod 0440 /etc/sudoers.d/ubuntu
USER ubuntu

# Headless GUI for pluginval / Standalone smoke tests: start with
#   Xvfb :99 -screen 0 1280x720x24 &   (devcontainer.json postStartCommand does this)
ENV DISPLAY=:99
