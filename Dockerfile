# The Juwa API.
#
# Deploys to anything that takes a container — Railway, Render, Fly, Cloud Run.
# The web app is NOT in here; that is static files on a CDN (see netlify.toml).

FROM node:20-slim AS build
WORKDIR /app

# Copy manifests first so `npm ci` is cached until a dependency actually changes.
COPY package.json package-lock.json ./
COPY packages/money/package.json      packages/money/
COPY packages/economy/package.json    packages/economy/
COPY packages/ui/package.json         packages/ui/
COPY packages/engine/package.json     packages/engine/
COPY packages/server/package.json     packages/server/
COPY packages/api/package.json        packages/api/
COPY app/package.json                 app/

# --ignore-scripts skips the app's native build hooks, which this image does not
# need and which pull in a large toolchain.
RUN npm ci --legacy-peer-deps --ignore-scripts

COPY packages/ packages/
RUN npm run build --workspace @juwa/money \
 && npm run build --workspace @juwa/economy \
 && npm run build --workspace @juwa/ui \
 && npm run build --workspace @juwa/engine \
 && npm run build --workspace @juwa/server \
 && npm run build --workspace @juwa/api

# ---------------------------------------------------------------- runtime

FROM node:20-slim
WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages ./packages

# Never run as root. A container escape from an unprivileged process is a much
# smaller problem than one from root.
USER node

EXPOSE 8787
# The server refuses to start without DATABASE_URL, SUPABASE_JWT_SECRET and
# ALLOWED_ORIGINS, so a misconfigured deploy fails loudly at boot rather than
# quietly accepting every token.
CMD ["node", "packages/api/dist/main.js"]
