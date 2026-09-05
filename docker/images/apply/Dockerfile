# ============================================================================
# Portta applier
# ============================================================================
# The one image that may drive Compose on the host, so that a settings change
# saved in the panel can be applied without a terminal.
#
# It exists because Traefik reads its static configuration from the environment
# its container was created with (docs/adr/0003-traefik-static-config-via-env.md):
# a saved setting needs the containers *recreated*, and recreating them means
# Compose, which the panel deliberately cannot reach
# (docs/adr/0008-web-panel-socket-proxy.md).
#
# Built on demand and cached locally, like the toolbox; never published. Off
# unless PORTTA_APPLY=true. See docs/adr/0026-applying-settings-from-the-panel.md.
#
# bash, not ash: bin/portta is a bash script, and the bash path is the only CLI
# an installed PORTTA_HOME has (install.sh copies bin and scripts, never packages).
#
# buildx, because `up` passes --build on a repository checkout. Nothing is built
# in here: the context is streamed over the mounted socket and the host daemon
# does the work, with the host's network and layer cache. The plugin is only how
# the compose CLI reaches that daemon, which is why --network none is no
# obstacle -- and why this image needs no toolchain of its own.
# ============================================================================
FROM alpine:3.24.1

ARG PORTTA_VERSION

# Pinned base, unpinned packages: Alpine's repositories only carry the current
# patch level for a release, so `apk add` inside 3.24.1 is already constrained.
RUN apk add --no-cache \
      bash \
      docker-cli \
      docker-cli-buildx \
      docker-cli-compose

LABEL org.opencontainers.image.title="portta-apply" \
      org.opencontainers.image.description="Recreates Portta's own containers on the host" \
      org.opencontainers.image.version="$PORTTA_VERSION" \
      org.opencontainers.image.source="https://github.com/fabioassuncao/portta" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT []
CMD ["/bin/bash"]
