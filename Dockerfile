FROM node

EXPOSE 3000
EXPOSE 5858

# use changes to package.json to force Docker not to use the cache
# when we change our application's nodejs dependencies:
RUN npm install -g nodemon
ADD package.json /tmp/package.json
RUN cd /tmp && npm install
RUN mkdir -p /opt/ospo-ghcrawler && cp -a /tmp/node_modules /opt/ospo-ghcrawler/

WORKDIR /opt/ospo-ghcrawler
ADD . /opt/ospo-ghcrawler

CMD nodemon --debug ./bin/www.js