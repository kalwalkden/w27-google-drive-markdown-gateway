FROM node:24-slim AS dependencies

ARG TARGETARCH
ARG MISE_VERSION=2026.9.1
ARG MISE_SHA256_AMD64=c98423c8470d6dc416d9f7036d0646d8ef5ae92ad9186907f8fcc84cbe7db4ea
ARG MISE_SHA256_ARM64=0ef0a778eaa8599f3e90a8a0979c9fc3f79922cafb5fa6d39f366d974da33bba

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && case "$TARGETARCH" in \
      amd64) mise_arch=x64; mise_sha256="$MISE_SHA256_AMD64" ;; \
      arm64) mise_arch=arm64; mise_sha256="$MISE_SHA256_ARM64" ;; \
      *) echo "unsupported Docker architecture: $TARGETARCH" >&2; exit 1 ;; \
    esac \
    && curl -fsSLo /usr/local/bin/mise \
      "https://github.com/jdx/mise/releases/download/v${MISE_VERSION}/mise-v${MISE_VERSION}-linux-${mise_arch}" \
    && echo "${mise_sha256}  /usr/local/bin/mise" | sha256sum --check --strict \
    && chmod 0755 /usr/local/bin/mise \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV MISE_DATA_DIR=/mise
COPY mise.toml mise.lock package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN mise install && mise run install

FROM dependencies AS build

COPY tsconfig.json tsconfig.build.json ./
COPY scripts/mark-cli-executable.mjs ./scripts/mark-cli-executable.mjs
COPY src ./src
RUN mise run build && mise run dependencies:production

FROM node:24-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
COPY --chown=node:node --from=build /app/package.json ./
COPY --chown=node:node --from=build /app/node_modules ./node_modules
COPY --chown=node:node --from=build /app/dist ./dist

USER node
EXPOSE 8080
CMD ["node", "dist/runtime/entry.js"]
