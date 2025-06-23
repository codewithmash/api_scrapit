const express = require('express');
const admin = require("../firebase1");
const router = express.Router();
const db = admin.firestore(); 
const { v4: uuidv4 } = require('uuid');

router.post('/addScrapType', async (req, res) => {
  const { name, description, ratePerKg, category, unit } = req.body;
  const scrapImage = req.file; 

  if (!name || !description || ratePerKg == null || !category || !unit) {
    return res.status(400).json({ error: 'All fields are required.' });
  }

  try {
  
    const customId = `ST_${uuidv4().replace(/-/g, '').substring(0, 10).toUpperCase()}`;
    
    let imageUrl = '';
    if (scrapImage) {
      // Example for Firebase Storage upload:
      const bucket = admin.storage().bucket();
      const file = bucket.file(`scrap_images/${customId}`);
      await file.save(scrapImage.buffer, { contentType: scrapImage.mimetype });
      imageUrl = await file.getSignedUrl({ action: 'read', expires: '03-09-2500' });
      imageUrl = imageUrl[0];
    }

    // Create document with custom ID
    const scrapTypeRef = db.collection('scrap_types').doc(customId);
  
    
    const scrapTypeData = {
      id: customId,
      name,
      description,
      ratePerKg,
      category,
      unit,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Add image URL if available
    if (imageUrl) {
      scrapTypeData.scrapImage = imageUrl;
    }

    await scrapTypeRef.set(scrapTypeData);

    return res.status(201).json({ 
      message: 'Scrap type added successfully.',
      id: customId,
      scrapType: {
        id: customId,
        name,
        description,
        ratePerKg,
        unit,
        category,
        scrapImage: imageUrl || null
      }
    });
  } catch (error) {
    console.error('Error adding scrap type:', error);
    return res.status(500).json({ 
      error: 'Internal server error.',
      details: error.message 
    });
  }
});

// router.post('/addScrapType', async (req, res) => {
//   const { name, description, ratePerKg, category} = req.body;

//   if (!name || !description || ratePerKg == null) {
//     return res.status(400).json({ error: 'All fields are required.' });
//   }

//   try {
//     // Generate a custom ID
//     const customId = `ST_${uuidv4().replace(/-/g, '').substring(0, 10).toUpperCase()}`;
    
//     // Create document with custom ID
//     const scrapTypeRef = db.collection('scrap_types').doc(customId);
    
//     await scrapTypeRef.set({
//       id: customId, // Store ID in document as well
//       name,
//       description,
//       ratePerKg,
//       createdAt: admin.firestore.FieldValue.serverTimestamp(),
//       updatedAt: admin.firestore.FieldValue.serverTimestamp()
//     });

//     return res.status(201).json({ 
//       message: 'Scrap type added successfully.',
//       id: customId,
//       scrapType: {
//         id: customId,
//         name,
//         description,
//         ratePerKg
//       }
//     });
//   } catch (error) {
//     console.error('Error adding scrap type:', error);
//     return res.status(500).json({ 
//       error: 'Internal server error.',
//       details: error.message 
//     });
//   }
// });

router.post('/getScrapTypes', async (req, res) => {
  try {
    const snapshot = await db.collection('scrap_types').orderBy('name').get();

    const scrapTypes = snapshot.docs.map(doc => ({
      id: doc.id,
      ...doc.data()
    }));

    return res.status(200).json(scrapTypes);
  } catch (error) {
    console.error('Error fetching scrap types:', error);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});


module.exports = router;
