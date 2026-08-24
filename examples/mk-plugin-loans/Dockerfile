FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV PORT=4401
EXPOSE 4401
CMD ["node", "--experimental-strip-types", "src/main.ts"]
