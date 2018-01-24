/* eslint no-use-before-define: ["error", { "functions": false }] */

const socket = require('socket.io');
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const appDir = path.dirname(require.main.filename);



/**
* Peer Connect object
* @constructor
* @param {object} config - The config object.
* @param {object} server - Put your server in here.
*/
function PeerConnect(config, server) {
  /**
  * Config object defaults to true if not specified.
  */
  this.config = { ...config }; // eslint rules: parameters should be immutable
  this.config.threshold = this.config.threshold || 1;
  this.config.foldloading = this.config.foldLoading !== false;
  this.config.geolocate = this.config.geolocate !== false;
  this.config.peerVideos = this.config.peerVideos !== false;
  this.config.peerImages = this.config.peerImages !== false;

  const imageTypes = ['jpeg', 'jpg', 'png', 'gif'];

  /** Filter out the excluded assetTypes */
  this.config.excludeFormats = lowerCaseConfig(this.config.excludeFormats);

  if (!this.config.peerImages) {
    this.config.assetTypes = [];
  } else {
    this.config.assetTypes = imageTypes.filter(type => !this.config.excludeFormats.includes(type));
  }

  /** NON-CONFIGURABLES - Sockets setup */
  this.io = socket(server);
  /** Stores list of all clients actively using app */
  this.activeClients = {};
  /** Information that signaling server holds */
  this.serverStats = {
    numClients: 0,
    numInitiators: 0,
    hasHeights: false,
    imageHeights: [],
  };

  /** Socket.io - 'connection' triggers on client connection */
  this.io.on('connection', (client) => {
    console.log(`socket connection started. ID: ${client.id}`);
    this.serverStats.numClients += 1;
    this.activeClients[client.id] = {
      id: client.id,
      initiator: false,
      offer: null,
      location: null,
    };

    /** Fs loop for torrents */
    if (this.config.peerVideos) {
      fs.readdir(appDir + `${config.torrentRoute.slice(1)}/torrent`, (err, files) => {
        if (err) {
          console.log(err);
        }
        files.forEach(file => {
          client.emit('torrent', `${file}`)
        });
      });
    } else {
      client.emit('load_server_video');
    }

    /** Creation of peers handled here */
    if (this.config.geolocate && this.config.peerImages) {

      /** Uses staticIP if localhost uses static ip */
      this.staticIP = '45.59.229.42';
      /** cip is the client's ip address */
      this.cip = client.client.request.headers['x-forwarded-for'] || client.client.conn.remoteAddress;
      if (this.cip[0] === ':') this.cip = this.staticIP;

      /**
      * Fetch request to IP API to determine location (longitude, latitude)
      * Saves location to activeClients
      */
      fetch(`http://freegeoip.net/json/${this.cip}`)
        .then(res => res.json())
        .then((json) => {
          const location = {
            lgn: json.longitude,
            lat: json.latitude,
            city: json.city,
            zipCode: json.zip_code,
            regionCode: json.region_code,
            country: json.country_code,
          };
          this.activeClients[client.id].location = location;

          /**
          * Creates a base initiator if there is no avaliable initiator
          * If initiators are available, create receiver peer
          */
          if (this.serverStats.numInitiators < this.config.threshold) {
            createBaseInitiator(client, this.config);
          } else {
            createReceiver(client, this.activeClients, this.config, this.serverStats);
          }
        })
        .catch((err) => {
        /** if API fetch fails, turn off geolocate and create a new initiator */
          console.log(err);
          createBaseInitiator(client, this.config);
        });
    } else {
      /** If geolocate is off */
      if (this.serverStats.numInitiators < this.config.threshold || !this.config.peerImages) {
        createBaseInitiator(client, this.config);
      }
      else if (this.serverStats.numInitiators >= this.config.threshold) {
        createReceiver(client, this.activeClients, this.config, this.serverStats);
      }
    }

    /**
    * Initiator sent offer object to server.
    * Store offer object to the client's respective object inside this.activeClients.
    * Set this client to an initiator and update this.numInitiators count.
    */
    client.on('offer_to_server', (message, imageHeights, hasHeights) => {
      this.serverStats.numInitiators += 1;
      this.activeClients[client.id].initiator = true;
      this.activeClients[client.id].offer = message.offer;
      if (imageHeights && !this.serverStats.hasHeights) {
        this.serverStats.imageHeights = imageHeights;
        this.serverStats.hasHeights = hasHeights;
      }
      console.log(`numClients, numInitiators: ${this.serverStats.numClients}, ${this.serverStats.numInitiators}`);
    });

    /**
    * Receiver sent answer object to server.
    * Send this answer object to the specific initiator that
    * provided the offer object to the receiver.
    */
    client.on('answer_to_server', (message, imageSliceIndex) => {
      client.to(message.peerId).emit('answer_to_initiator', message.answer, this.activeClients[client.id].location, imageSliceIndex);
    });

    /**
    * If the diconnected client was an initiator,
    * update accordingly with this.numClients as well
    */
    client.on('disconnect', () => {
      console.log(`disconnecting ${client.id}`);
      if (this.activeClients[client.id].initiator) {
        this.serverStats.numInitiators -= 1;
      }
      delete this.activeClients[client.id];
      this.serverStats.numClients -= 1;
      console.log(`numClients, numInitiators: ${this.serverStats.numClients}, ${this.serverStats.numInitiators}`);
    });
    client.on('error', err => console.log(err));
  });
}

/** create initiators after ip geolocation api call */
function createBaseInitiator(client, config) {
  client.emit('create_base_initiator', config.assetTypes, config.foldLoading, this.serverStats.hasHeights);
}
function createReceiver(client, activeClients, config, serverStats) {
  this.serverStats = serverStats;
  this.activeClients = activeClients;
  /** checks if geolocate config is on */
  if (config.geolocate) {
    /** current client's location */
    const clientLocation = this.activeClients[client.id].location;
    /** placeholder for the closest peer */
    const closestPeer = {
      id: '',
      distance: Infinity,
    };

    /**
    * iterate through this.activeClients to find closest initiator avaliable
    * make that initiator unavaliable (initiator key set to false).
    */
    let tempLocation = null;
    let tempDistance = 0;
    Object.values(this.activeClients).forEach((clientObj) => {
      if (clientObj.initiator) {
        tempLocation = this.activeClients[clientObj.id].location;
        tempDistance = distance(
          clientLocation.lat,
          clientLocation.lgn,
          tempLocation.lat,
          tempLocation.lgn,
        );
        if (tempDistance <= closestPeer.distance) {
          closestPeer.id = clientObj.id;
          closestPeer.distance = tempDistance;
        }
      }
    });
    const selectedInitiator = this.activeClients[closestPeer.id];
    const initiatorData = {
      offer: selectedInitiator.offer,
      peerId: closestPeer.id,
      location: selectedInitiator.location,
    };
    this.activeClients[closestPeer.id].initiator = false;
    // Updates this.numInitiators and emit to receiver and send initiator data
    this.serverStats.numInitiators -= 1;
    console.log(config.assetTypes);
    client.emit('create_receiver_peer', initiatorData, config.assetTypes, config.foldLoading, this.serverStats.imageHeights);
  } else {
    // loops through activeClients and randomly finds avaliable initiator
    const initiatorsArr = [];
    Object.values(this.activeClients).forEach((clientObj) => {
      if (clientObj.initiator) initiatorsArr.push(clientObj.id);
    });
    const selectedInitiatorId = initiatorsArr[Math.floor(Math.random() * initiatorsArr.length)];
    const initiatorData = {
      offer: this.activeClients[selectedInitiatorId].offer,
      peerId: selectedInitiatorId,
    };
    this.activeClients[selectedInitiatorId].initiator = false;
    // Updates this.numInitiators and emit to receiver and send initiator data
    this.serverStats.numInitiators -= 1;
    console.log(config.assetTypes);
    client.emit('create_receiver_peer', initiatorData, config.assetTypes, config.foldLoading);
  }
}
/**
* function to calculate distance using two sets of coordindates
* source: https://www.geodatasource.com/developers/javascript
*/
function distance(lat1, lon1, lat2, lon2) {
  const radlat1 = Math.PI * (lat1 / 180);
  const radlat2 = Math.PI * (lat2 / 180);
  const theta = lon1 - lon2;
  const radtheta = Math.PI * (theta / 180);
  let dist = (Math.sin(radlat1) * Math.sin(radlat2));
  dist += (Math.cos(radlat1) * Math.cos(radlat2) * Math.cos(radtheta));
  dist = Math.acos(dist);
  dist = (dist * 180) / Math.PI;
  dist = dist * 60 * 1.1515;
  return dist;
}

function declareAssetTypes(mediaTypes, typesObj) {
  return (
    mediaTypes.reduce((includedTypes, mediaType) => includedTypes.concat(typesObj[mediaType]), [])
  );
}

function lowerCaseConfig(arr) {
  return arr.map(str => str.toLowerCase());
}

/**
* Function that handles torrents and video files
*/
function VideoConnect (peerConfig, app) {
  const createTorrent = require('create-torrent');
  const fs = require('fs');
  const path = require('path');

  const videoRoute = peerConfig.videoRoute;
  const torrentRoute = peerConfig.torrentRoute;
  const domainName = peerConfig.domainName;

  fs.readdir(appDir + videoRoute.slice(1), (err, files) => {
    if (err) {
      console.log(err);
    }

    /** Creates routes for each mp4 file to serve as webseeds */
    files.forEach(file => {
      // console.log(file);
      app.get(`/video/${file}`, (req, res) => {
        res.sendFile(appDir + route.slice(1) + file);
      });
    });
  });


  /** If torrent folder already exists, just create routes */
  if (fs.existsSync(`${torrentRoute}/torrent`)) {
    fs.readdir(appDir + videoRoute.slice(1), (err, files) => {
      if (err) {
        console.log(err);
      }

      /** Loops through video files and create torrent routes that send torrent files */
      files.forEach(file => {
        app.get(`/torrent/${file.slice(0, -4)}.torrent`, (req, res) => {
          res.sendFile(appDir + `${torrentRoute.slice(1)}/torrent/` + `${file.slice(0, -4)}.torrent`);
        });
      });
    });
    return
  }

  /** Makes torrent directory */
  fs.mkdir(`${torrentRoute}/torrent`);

  fs.readdir(appDir + videoRoute.slice(1), (err, files) => {
    if (err) {
      console.log(err);
    }

    files.forEach(file => {
      //THIS IS FOR ACTUAL
      /** Creates torrents with the mp4 links as webseed */
      // createTorrent(appDir + videoRoute.slice(1) + '/' + file, { urlList: [`${domainName}/video/${file}`] }, (err, torrent) => {
      //THIS IS FOR TEST
      createTorrent(appDir + videoRoute.slice(1) + '/' + file, { urlList: [`${domainName}/${file}`] }, (err, torrent) => {
        fs.writeFile(appDir + `/assets/torrent/${file.slice(0 , -4)}.torrent`, torrent, (err) => {
          if (err) {
            console.log(err)
          }
        });
      });

      /** Creates routes to serve torrent files according to name */
      app.get(`/torrent/${file.slice(0, -4)}.torrent`, (req, res) => {
        res.sendFile(appDir + `${torrentRoute.slice(1)}/torrent/` +  `${file.slice(0, -4)}.torrent`);
      });
    });
  });
}


module.exports = { PeerConnect, VideoConnect };
