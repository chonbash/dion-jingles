# Контейнер-слушатель: отдельный участник dion.vc без расширения.
# Виртуальный микрофон — тишина из WAV, «динамик» — запись входящего звука в странице.
FROM mcr.microsoft.com/playwright:v1.49.1-noble

WORKDIR /app
RUN npm init -y >/dev/null && npm install playwright@1.49.1 >/dev/null
COPY listen.mjs /app/listen.mjs

ENTRYPOINT ["node", "/app/listen.mjs"]
