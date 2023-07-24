// A node.js script that listens to a Matrix room and writes the messages to a vcon file.
// It also posts the vcon file to a conserver on a regular basis.
//
// Original version for the IETF 117 Hackathon by Thomas McCarthy-Howe
const dotenv = require('dotenv');
dotenv.config();


const fs = require("fs");
const moment = require("moment");
const sdk = require("matrix-js-sdk");
const uuid = require("uuid");

// CONFIGURATION
const SYNAPSE_ACCESS_TOKEN = process.env.SYNAPSE_ACCESS_TOKEN || "xxxxxxx"
const SYNAPSE_USER_ID = process.env.SYNAPSE_USER_ID || "@howethomas:localhost";
const VCON_PATH = process.env.VCON_PATH || "./vcons";
const DOMAIN_NAME = process.env.DOMAIN_NAME || "ietf.org"
const CONSERVER_URL = process.env.CONSERVER_URL || "https://localhost:8000/vcon";
const SYNAPSE_URL = process.env.SYNAPSE_URL || "http://localhost:8008";
const VCON_UPLOAD_PERIOD_MS = process.env.VCON_UPLOAD_PERIOD_MS || 3600000; // 1 hour
const DEFAULT_ROLE = process.env.DEFAULT_ROLE || "agent";

const client = sdk.createClient({ 
  baseUrl: SYNAPSE_URL,
  accessToken: SYNAPSE_ACCESS_TOKEN,
  userId: SYNAPSE_USER_ID
});

client.on("Room.timeline", function (event, room, toStartOfTimeline) {
   // only use messages from the room
   // and only if they are text messages
  if (event.getType() !== "m.room.message") {
      return;
  }
  
  // Try to read the existing vcon file if it exists, otherwise create a new one
  // The filename is based on the room name and the room id, so we can track
  // the vcons even if the name changes.
  filename = `${VCON_PATH}/${room.name}:${event.event.room_id}.vcon`;

  // Make the vCon, based on the IETF vCon JSON schema
  let vcon = {};
  try {
    // If the file exists, read it,
    // otherwise, create a new vcon object.
    // If the file is not valid JSON, we'll get an error
    vcon = JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (err) {
    // Create a new vcon object, based on the IETF vCon JSON schema
    console.debug("Creating new vcon file: ", filename);
    vcon = {
      "uuid": event.event.room_id,
      "vcon": "0.0.1",
      "dialog": [],
      "parties": [],
      "subject": null,
      "analysis": [],
      "created_at": null,
      "attachments": []
    }

    // If this is a new vcon, set the created_at timestamp in ISO format
    vcon.created_at = moment().toISOString();

    // Add the uuid, based on the domain name
    vcon.uuid = uuid.v5(DOMAIN_NAME, uuid.v5.DNS);

    // Add the subject, based on the room name
    vcon.subject = "Recording of " + room.name;
  }

  // Check to see if the sender is already one of the parties. If not, add them.
  let sender = event.event.sender;
  let sender_name = sender.split(":")[0].substring(1);
  let sender_domain = sender.split(":")[1];
  let sender_id = sender.split(":")[2];
  let sender_party = vcon.parties.find(p => p.tel === sender_name);
  if (!sender_party) {
    console.debug("Adding sender: ", sender_name);
    sender_party = {
      "tel": sender_name,
      "meta": {
        "role": DEFAULT_ROLE,
        "extension": sender_id
      },
      "name": sender_name,
      "mailto": sender_name + "@" + sender_domain
    }
    vcon.parties.push(sender_party);
  }
  // We save the matrix event into the dialog, so we can avoid duplicates
  // Check to see if this message is already in the dialog, and if so, skip it
  let dialog = vcon.dialog.find(d => d.meta.matrix_event.event_id === event.event.event_id);
  if (dialog) {
    console.debug("Skipping duplicate message: ", event.event.event_id);
    return;
  }

  // Now, add this message to the dialog
  // This is the chatty part of the vCon. We make a new dialog object for every message.
  // Perhaps a time where we could summarize this in an analysis object.
  // However, we do want to keep the original message, so we can't just summarize it.
  dialog = {
    "body": event.event.content.body,
    "meta": {
     "matrix_event": event.event
    },
    "type": "text",
    "start": moment(event.event.origin_server_ts).toISOString(),
    "parties": [vcon.parties.indexOf(sender_party)],
    "originator": [vcon.parties.indexOf(sender_party)], 
    "encoding": "text/plain"
  }
  vcon.dialog.push(dialog);
  console.debug("Added dialog: ", dialog);

  // Write the vcon file
  fs.writeFileSync(filename, JSON.stringify(vcon, null, 2))
  console.debug("Wrote vcon file: ", filename)
});

client.startClient({ initialSyncLimit: 10 });
console.log("Started client.")

// Every hour, we'll check to see if we have any vcon files that are older than 24 hours.
// If so, we'll POST them to the vcon server.
setInterval(function() {
  fs.readdirSync(VCON_PATH).forEach(file => {
    console.log("Checking file: ", file)
    let filename = `${VCON_PATH}/${file}`;
    let vcon = JSON.parse(fs.readFileSync(filename, 'utf8'));
    let created_at = moment(vcon.created_at);
    let now = moment();
    let diff = now.diff(created_at, 'hours');
    if (diff > 1) {
      console.debug("Posting vcon file: ", filename);
      // Read the JSON file
      const jsonData = fs.readFileSync(filename);

      // POST the JSON data to the URL
      const response = fetch(CONSERVER_URL, {
        method: "POST",
        body: jsonData,
      });

      // Check the status code
      if (response.status === 200) {
        console.debug("Successfully posted JSON data!");
      } else {
        console.error("Error posting JSON data!");
      }

      // Delete the JSON file
      fs.unlinkSync(filename);
    }
  });
}, VCON_UPLOAD_PERIOD_MS);