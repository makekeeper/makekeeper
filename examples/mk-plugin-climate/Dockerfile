FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV PORT=4405
EXPOSE 4405
CMD ["node", "--experimental-strip-types", "src/main.ts"]
