# Reference external plugin. Runs beside the MakeKeeper core; the admin adds it
# to their own compose stack and pastes a one-time install token into the env.
FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV PORT=4400
EXPOSE 4400
CMD ["node", "--experimental-strip-types", "src/main.ts"]
