const Peer = SimplePeer;
const peerMethods = emitters;

// indicates if client has downloaded assets from server
// and can send assets to new client connections
// track if assets have been downloaded
let assetsDownloaded = false;
// placeholder for webrtc peer
let p = null;

// Establish connection
const socket = io.connect();

// front end is always notified of peer count
socket.on('peer_count', message => {
  console.log(`peer count, initator count : ${message.numClients}, ${message.numInitiators}`)
  console.log(typeof message.numInitiators)
  if (message.numClients === 1 || message.numInitiators === 0) {
    loadAssetsFromServer();
    assetsDownloaded = true;
    sendNowInitiator()
    return;
  }
  // create peer-initiator
  if (message.numClients > 1 && assetsDownloaded) {
    if (!p) {
      console.log('created initiator and offer obj')
      p = new Peer({ initiator: true, trickle: false });
      peerMethods(p)
    }
    return;
  }
  // create peer non-initiator
  if (message.numClients > 1 && !p){
    console.log('initiating non-initiator peer')
    p = new Peer({ initiator: false, trickle: false });
    peerMethods(p)
  }
})

socket.on('messaged', message => {
  const parsedMsg = JSON.parse(message.message)
  if (assetsDownloaded && parsedMsg.type === 'answer') {
    console.log('received answer obj')
    p.signal(parsedMsg)
    return;
  }
  if (!assetsDownloaded && parsedMsg.type === 'offer') {
    console.log('received offer obj')
    p.signal(parsedMsg)
    return;
  }
})

// sends a message back to the singaling server
function sendWRTCMsg(message) {
  socket.emit("WRTC_msg", message);
}

function sendNowInitiator() {
  socket.emit('now_initiator', {id: socket.id})
}

function sendAssetsToPeer(peer) {
  // ** convert files into data chunks and send **
  convertToChunks()
  peer.send('this is the data being sent!')
  console.log('message sent')
}

function downloadAssetsFromPeer() {
  // store chunks here?
  console.log("LOAD ASSETS FROM PEER");
}

// download assets from server
function loadAssetsFromServer() {
  console.log("LOAD ASSETS FROM SERVER");
  // query DOM for test images
  const image1 = document.getElementById("image1");
  const image2 = document.getElementById("image2");
  const image3 = document.getElementById("image3");

  // if new client is the first on the page
  // and has not downloaded assets yet
  image1.setAttribute("src", "../assets/image1.jpg");
  image2.setAttribute("src", "../assets/image2.png");
  image3.setAttribute("src", "../assets/image3.jpg");
}

function convertToChunks() {
  // convert files into chunks
  console.log('converted files into chunks!')
}

function convertDataToUsable() {
  // convert chunks/data to usable data
  console.log('converted files to usables!')
}
