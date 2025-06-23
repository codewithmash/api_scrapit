const admin = require('firebase-admin');
const serviceAccount = require('./serviceAccountKey.json');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: "https://scrapit-439211-default-rtdb.firebaseio.com/",
  storageBucket : "scrapit-439211.firebasestorage.app"
});

module.exports = admin;
