//const { createServer } = require('node:http');
//const { parse } = require('node:url');
import nodeHTTP from 'node:http'; let {createServer} = nodeHTTP;
import nodeURL from 'node:url'; let {parse} = nodeURL;
//const GtfsRealtimeBindings = require('gtfs-realtime-bindings');
import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import fetch from 'node-fetch';

const RATE_LIMIT_TIME_SECONDS = 30;
let lastFetchTimeForURL = {};
let lastFetchForURL = {};
const fetchFeed = async(fetchURL) => {
  if (!lastFetchTimeForURL.hasOwnProperty(fetchURL)) {
    lastFetchTimeForURL[fetchURL] = -RATE_LIMIT_TIME_SECONDS - 1;
  }
  const requestTimeInSeconds = Math.round(Date.now() / 1000);
  if (requestTimeInSeconds - lastFetchTimeForURL[fetchURL] < RATE_LIMIT_TIME_SECONDS) {
    const response = await lastFetchForURL[fetchURL];
    if (!response.ok) {
      const error = new Error(`${response.url}: ${response.status} ${response.statusText}`);
      error.response = response;
      throw error;
    }
    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );
    return feed;
  }

  try {
    let fetchPromise = fetch(fetchURL, {
      headers: {
        "x-api-key": "<redacted>",
        // replace with your GTFS-realtime source's auth token
        // e.g. x-api-key is the header value used for NY's MTA GTFS APIs
      },
    });
    lastFetchForURL[fetchURL] = fetchPromise;
    const response = await fetchPromise;
    if (!response.ok) {
      const error = new Error(`${response.url}: ${response.status} ${response.statusText}`);
      error.response = response;
      throw error;
    }
    const buffer = await response.arrayBuffer();
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );
    return feed;

  }
  catch (error) {
    console.log(error);
    process.exit(1);
  }
}

const filterFeed = (feed, stopId = 'A15', routeIds = []) => {
  const currentTimeInSeconds = Math.round(Date.now() / 1000);
  let data = {};
  routeIds.forEach(routeId => data[routeId] = []);
  if (!feed.entity) {
    return data;
  }
  feed.entity.forEach((entity) => {
    if (entity.tripUpdate) {
      let routeId = entity.tripUpdate.trip.routeId;
      if (routeIds.length > 0 && !routeIds.includes(routeId)) {
        return;
      }
      if (entity.tripUpdate.stopTimeUpdate) {
        entity.tripUpdate.stopTimeUpdate.forEach((stopTimeUpdate) => {
          if (stopTimeUpdate.stopId && stopTimeUpdate.stopId.includes(stopId)) {
            let secondsTilArrival = stopTimeUpdate.arrival.time.low - currentTimeInSeconds;
            let minutesTilArrival = Math.round(secondsTilArrival / 60);
            data[routeId].push(minutesTilArrival);
          }
        });
      }
    }
  }); 
  routeIds.forEach(routeId => data[routeId] = data[routeId].sort((a, b) => a - b));
  return data;
}

const BDFM_TRAIN_URL = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm";
const ACE_TRAIN_URL = "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace";

const hostname = '0.0.0.0';
const port = 10000;

const server = createServer(async (req, res) => {
  var parsedURL = parse(req.url, true);
  var queryData = parsedURL.query;

  let data = [];
  // `A15S` means the 125th stop going downtown
  data = data.concat(filterFeed(await fetchFeed(ACE_TRAIN_URL), 'A15S', ['A']));
  data = data.concat(filterFeed(await fetchFeed(BDFM_TRAIN_URL), 'A15S', ['D']));
  // `A16S` means the 116th stop going downtown
  data = data.concat(filterFeed(await fetchFeed(ACE_TRAIN_URL), 'A16S', ['C']));
  data = data.concat(filterFeed(await fetchFeed(BDFM_TRAIN_URL), 'A16S', ['B']));

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({data}));
});

server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
});
