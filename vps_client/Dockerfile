FROM alpine:latest

# Install FFmpeg, Node.js, NPM, and Bash in one fast layer
RUN apk add --no-cache ffmpeg nodejs npm bash

# Create app directory
WORKDIR /usr/src/app

# Copy package.json
COPY package.json ./

# Copy server code
COPY server.js ./

# Create cache directory and grant absolute write permissions
RUN mkdir -p cache_segments && chmod -R 777 cache_segments

# Expose default port assigned by Railway
EXPOSE 8080

CMD [ "node", "server.js" ]
