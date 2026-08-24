FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV PORT=4402
EXPOSE 4402
CMD ["node", "--experimental-strip-types", "src/main.ts"]
