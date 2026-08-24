FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV PORT=4404
EXPOSE 4404
CMD ["node", "--experimental-strip-types", "src/main.ts"]
