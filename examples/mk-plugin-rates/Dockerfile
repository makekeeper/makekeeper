FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV PORT=4403
EXPOSE 4403
CMD ["node", "--experimental-strip-types", "src/main.ts"]
