// debug-fetch-records.js
const fs = require("fs");
const moment = require("moment");
const sdk = require("matrix-js-sdk");
const uuid = require("uuid");
const myAccessToken = "xxxxxxx"
const myUserId = "@howethomas:localhost";
const vcon_path = "./vcons";
const domain_name = "ietf.org"
const url = "https://api.example.com/data";

const client = sdk.createClient({ 
  baseUrl: "http://localhost:8008",
  accessToken: myAccessToken,
  userId: myUserId
});

client.on("Room.timeline", function (event, room, toStartOfTimeline) {
  if (event.getType() !== "m.room.message") {
      return; // only use messages
  }
  
  // Try to read the existing vcon file if it exists, otherwise create a new one
  filename = `${vcon_path}/${room.name}:${event.event.room_id}.vcon`;
  let vcon = {};
  try {
    vcon = JSON.parse(fs.readFileSync(filename, 'utf8'));
  } catch (err) {
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
    vcon.uuid = uuid.v5(domain_name, uuid.v5.DNS);
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
        "role": "agent",
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
  fs.readdirSync(vcon_path).forEach(file => {
    console.log("Checking file: ", file)
    let filename = `${vcon_path}/${file}`;
    let vcon = JSON.parse(fs.readFileSync(filename, 'utf8'));
    let created_at = moment(vcon.created_at);
    let now = moment();
    let diff = now.diff(created_at, 'hours');
    if (diff > 1) {
      console.debug("Posting vcon file: ", filename);
      // Read the JSON file
      const jsonData = fs.readFileSync(filename);

      // POST the JSON data to the URL
      const response = fetch(url, {
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
}, 3600000); // 1 hour

