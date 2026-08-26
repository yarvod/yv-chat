FROM node:24-alpine AS build

ARG NUXT_PUBLIC_DEVICE_PAIRING_ORIGINS='["https://chat.yoowee.ru","https://chat.yoowee.com.de","https://app.yvchat.local","capacitor://app.yvchat.local"]'
ENV NUXT_PUBLIC_DEVICE_PAIRING_ORIGINS=${NUXT_PUBLIC_DEVICE_PAIRING_ORIGINS}

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run postinstall && npm run build

FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    NITRO_HOST=0.0.0.0 \
    NITRO_PORT=3000

WORKDIR /app
COPY --from=build --chown=node:node /app/.output ./.output

USER node

EXPOSE 3000

CMD ["node", ".output/server/index.mjs"]
