const express = require('express');
const router = express.Router();
const jwt = require('jsonwebtoken');
const admin = require('../../firebase1');


const db = admin.firestore();
router.post('/zones', async (req, res) => {
  try {
    const { name, description, polygon } = req.body;

    if (!name || !polygon || !Array.isArray(polygon)) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['name', 'polygon (array)']
      });
    }

    if (polygon.length < 3) {
      return res.status(400).json({ 
        error: 'Polygon must have at least 3 points'
      });
    }

    for (const point of polygon) {
      if (typeof point.lat !== 'number' || typeof point.lng !== 'number') {
        return res.status(400).json({ 
          error: 'Each polygon point must have lat and lng numbers'
        });
      }

      if (point.lat < -90 || point.lat > 90) {
        return res.status(400).json({ 
          error: `Invalid latitude ${point.lat}. Must be between -90 and 90`
        });
      }

      if (point.lng < -180 || point.lng > 180) {
        return res.status(400).json({ 
          error: `Invalid longitude ${point.lng}. Must be between -180 and 180`
        });
      }
    }

    const isActive = true;
    const zoneId = generateRandomId(); 
    
    const zoneData = {
      id: zoneId, 
      name,
      description: description || '',
      polygon,
      isActive,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    await db.collection('zones').doc(zoneId).set(zoneData);

    return res.status(201).json({
      success: true,
      message: 'Zone created successfully',
      zoneId: zoneId
    });

  } catch (error) {
    console.error('Error creating zone:', error);
    return res.status(500).json({
      error: 'Failed to create zone',
      details: error.message
    });
  }
});

router.delete('/zones/:id', async (req, res) => {
  try {
    const zoneId = req.params.id;
    
    const doc = await db.collection('zones').doc(zoneId).get();
    
    if (!doc.exists) {
      return res.status(404).json({ 
        error: 'Zone not found' 
      });
    }

    await db.collection('zones').doc(zoneId).delete();
    
    return res.status(200).json({
      success: true,
      message: 'Zone deleted successfully'
    });

  } catch (error) {
    console.error('Error deleting zone:', error);
    return res.status(500).json({
      error: 'Failed to delete zone',
      details: error.message
    });
  }
});

router.put('/zones/:id', async (req, res) => {
  try {
    const zoneId = req.params.id;
    const { name, description, polygon, isActive } = req.body;
    const updateData = { 
      updatedAt: admin.firestore.FieldValue.serverTimestamp() 
    };

    if (!name && !description && !polygon && typeof isActive === 'undefined') {
      return res.status(400).json({ 
        error: 'No fields to update provided',
        possibleUpdates: ['name', 'description', 'polygon', 'isActive']
      });
    }

    if (polygon) {
      if (!Array.isArray(polygon)) {
        return res.status(400).json({ 
          error: 'Polygon must be an array'
        });
      }
      if (polygon.length < 3) {
        return res.status(400).json({ 
          error: 'Polygon must have at least 3 points'
        });
      }
      updateData.polygon = polygon;
    }

    if (name) updateData.name = name;
    if (description) updateData.description = description;
    if (typeof isActive !== 'undefined') {
      updateData.isActive = Boolean(isActive);
    }

    const doc = await db.collection('zones').doc(zoneId).get();
    if (!doc.exists) {
      return res.status(404).json({ 
        error: 'Zone not found' 
      });
    }

    await db.collection('zones').doc(zoneId).update(updateData);
    
    return res.status(200).json({
      success: true,
      message: 'Zone updated successfully',
      zoneId
    });

  } catch (error) {
    console.error('Error updating zone:', error);
    return res.status(500).json({
      error: 'Failed to update zone',
      details: error.message
    });
  }
});


router.get('/zones', async (req, res) => {
  try {
    const snapshot = await db.collection('zones').get();
    const zones = [];
    
    snapshot.forEach(doc => {
      zones.push({
        id: doc.id,
        ...doc.data()
      });
    });

    return res.status(200).json({
      success: true,
      zones
    });

  } catch (error) {
    console.error('Error fetching zones:', error);
    return res.status(500).json({
      error: 'Failed to fetch zones',
      details: error.message
    });
  }
});

const generateRandomId = () => {
  return Math.random().toString(36).substring(2, 15) + 
         Math.random().toString(36).substring(2, 15);
};

module.exports = router;