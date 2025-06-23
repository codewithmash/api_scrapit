const express = require('express');
const router = express.Router();
const admin = require('../firebase1');

router.post('/verifyToken', async (req, res) => {
  const idToken = req.body.token;
  try {
    const decoded = await admin.auth().verifyIdToken(idToken);
    res.status(200).json({ message: 'Token verified!', uid: decoded.uid });
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
});

module.exports = router;
