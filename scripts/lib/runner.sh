#!/usr/bin/env bash
# Portta: the project runner container.
#
# The panel's Docker permissions stop at start, stop, restart and one fixed
# container shape, so operations Compose must perform (rebuild, down, start
# when the containers are gone) go through one opt-in container whose command
# is fixed at creation. See docs/adr/0030-the-panel-and-a-project-lifecycle.md.
#
# Off unless PORTTA_RUNNER=true.
#
# `up` is one of the commands ADR 0015 requires to work with no Node on the
# host, and preparing the runner is part of what `up` does -- so this file is
# the zero-Node implementation of a contract whose source of truth is
# runnerCreateArguments in packages/core/src/runner.ts.
# tests/unit/runner.test.sh runs both and compares the resulting `docker create`
# argument lists.

PORTTA_RUNNER_IMAGE="fabioassuncao/portta-apply:$(portta_version)"
PORTTA_RUNNER_CONTAINER="portta-runner"

portta_runner_spec() {
  printf '%s|%s|%s' "$PORTTA_RUNNER_IMAGE" "$PORTTA_ROOT" "$(portta_version)"
}

# portta_runner_refusal: why this host must not prepare a runner, or empty.
# Mirrors runnerRefusal in packages/core/src/runner.ts.
portta_runner_refusal() {
  if [ "${PORTTA_WEB_EXPOSE:-local}" = "public" ]; then
    printf 'the panel is exposed publicly: operate projects on the host instead'; return 0
  fi
  if [ "${PORTTA_PROFILE:-local}" = "remote-public" ]; then
    printf 'the remote-public profile operates projects on the host only'; return 0
  fi
  printf ''
}

# portta_runner_create: the container, stopped, with its command fixed.
# Every flag here is explained in packages/core/src/runner.ts; keep both in step.
portta_runner_create() {
  docker create \
    --name "$PORTTA_RUNNER_CONTAINER" \
    --label portta.managed=true \
    --label portta.component=runner \
    --label "portta.runner.spec=$(portta_runner_spec)" \
    --label traefik.enable=false \
    --restart no \
    --network none \
    --user 0:0 \
    --security-opt no-new-privileges:true \
    --workdir "$PORTTA_ROOT" \
    --env PORTTA_ROOT="$PORTTA_ROOT" \
    --env PORTTA_FORCE_BASH=true \
    --env HOME=/tmp \
    --volume /var/run/docker.sock:/var/run/docker.sock \
    --volume "$PORTTA_ROOT:$PORTTA_ROOT" \
    --volume /:/host \
    "$PORTTA_RUNNER_IMAGE" \
    bash "$PORTTA_ROOT/scripts/lib/runner-exec.sh"
}

# portta_runner_remove <id>: only ever a container the gateway created, and never
# one that is running right now.
portta_runner_remove() {
  local id="$1"
  portta_container_is_managed "$id" || {
    warn "a container named $PORTTA_RUNNER_CONTAINER exists and is not ours; leaving it alone"
    return 1
  }
  if [ "$(portta_container_state "$id")" = "running" ]; then
    warn "a project operation is running; leaving the runner in place"
    return 1
  fi
  docker rm -f "$id" >/dev/null 2>&1
}

# portta_runner_ensure: reconcile the runner with PORTTA_RUNNER. Called at the
# end of `up`, and never fatal.
portta_runner_ensure() {
  local id refusal
  id=$(portta_gateway_container runner)

  if ! portta_is_true "${PORTTA_RUNNER:-false}"; then
    [ -n "$id" ] || return 0
    portta_runner_remove "$id" && info "runner removed (PORTTA_RUNNER is false)"
    return 0
  fi

  refusal=$(portta_runner_refusal)
  if [ -n "$refusal" ]; then
    warn "not preparing the runner: $refusal"
    [ -n "$id" ] && portta_runner_remove "$id" >/dev/null 2>&1
    return 0
  fi

  if [ -n "$id" ]; then
    [ "$(docker inspect "$id" --format '{{ index .Config.Labels "portta.runner.spec" }}' 2>/dev/null)" \
      = "$(portta_runner_spec)" ] && return 0
    info "the runner is stale; recreating it"
    portta_runner_remove "$id" || return 0
  fi

  portta_apply_image_ensure || { warn "project operations still run with: docker compose"; return 0; }
  if portta_runner_create >/dev/null; then
    ok "runner ready; the panel can operate a project without a terminal"
  else
    warn "the runner could not be created; project operations still run from a shell"
  fi
  return 0
}
