const express = require('express');
const router = express.Router();
const admin = require("../firebase1");
const db = admin.firestore();
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const bucket = admin.storage().bucket();
const upload = multer({ storage: multer.memoryStorage() });

async function deleteFileFromStorage(fileUrl) {
  if (!fileUrl) return;

  try {
    // Extract file path from URL
    const baseUrl = `https://storage.googleapis.com/${bucket.name}/`;
    if (fileUrl.startsWith(baseUrl)) {
      const filePath = fileUrl.replace(baseUrl, '');
      const file = bucket.file(decodeURIComponent(filePath));
      await file.delete();
    }
  } catch (error) {
    console.error('Error deleting file:', error);
    throw error;
  }
}

router.post('/addEnquiry', async (req, res) => {
  try {
    const {
      apartmentName,
      apartmentType,
      personInCharge,
      contactNumber,
      extraInfo
    } = req.body;

    if (!apartmentName || !apartmentType || !personInCharge || !contactNumber) {
      return res.status(400).json({ message: 'Missing required fields' });
    }

    // Generate random 8-character alphanumeric ID
    const enquiryId = Math.random().toString(36).substring(2, 10).toUpperCase();

    const newEnquiry = {
      enquiryId, // Add the generated ID to the document
      apartmentName,
      apartmentType,
      personInCharge,
      contactNumber,
      extraInfo: extraInfo || '',
      status :"pending",
      createdAt: admin.firestore.FieldValue.serverTimestamp()
    };

    // Add document with auto-generated Firestore ID but store our custom ID in the data
    const docRef = await db.collection('campaignEnquiry').add(newEnquiry);
    
    return res.status(201).json({ 
      message: 'Enquiry submitted successfully',
      enquiryId: enquiryId // Return our custom ID instead of Firestore's
    });
  } catch (error) {
    console.error('Error adding campaign enquiry:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/updateEnquiryStatus/:enquiryId', async (req, res) => {
  try {
    const { enquiryId } = req.params;
    const { status, latitude, longitude, reason } = req.body;

    if (!['approved', 'rejected'].includes(status)) {
      return res.status(400).json({ message: 'Status must be either "approved" or "rejected"' });
    }

    const snapshot = await db.collection('campaignEnquiry')
      .where('enquiryId', '==', enquiryId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ message: 'Enquiry not found' });
    }

    const doc = snapshot.docs[0];

    const updateData = {
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    if (status === 'approved') {
      if (!latitude || !longitude) {
        return res.status(400).json({ message: 'Latitude and longitude are required for approval' });
      }
      updateData.location = new admin.firestore.GeoPoint(parseFloat(latitude), parseFloat(longitude));
      updateData.approvedAt = admin.firestore.FieldValue.serverTimestamp();
    }

    if (status === 'rejected') {
      updateData.rejectedAt = admin.firestore.FieldValue.serverTimestamp();
      updateData.rejectionReason = reason || "No reason provided";
    }

    await doc.ref.update(updateData);

    return res.status(200).json({
      message: `Enquiry ${status} successfully`,
      enquiryId
    });

  } catch (error) {
    console.error('Error updating campaign enquiry status:', error);
    return res.status(500).json({ error: error.message });
  }
});


router.get('/getEnquiries', async (req, res) => {
  try {
    const snapshot = await db.collection('campaignEnquiry')
      .orderBy('createdAt', 'desc')
      .get();

    if (snapshot.empty) {
      return res.status(200).json({ message: 'No enquiries found', enquiries: [] });
    }

    const enquiries = [];
    snapshot.forEach(doc => {
      enquiries.push({
        // Include both Firestore's doc.id and our custom enquiryId
        firestoreId: doc.id,
        ...doc.data()
      });
    });

    return res.status(200).json({ enquiries });
  } catch (error) {
    console.error('Error fetching enquiries:', error);
    return res.status(500).json({ error: error.message });
  }
});

router.post('/delete-enquiry', async (req, res) => {
  try {
    const { enquiryId } = req.body; // Get our custom ID from request body

    if (!enquiryId) {
      return res.status(400).json({ error: 'Enquiry ID is required' });
    }

    // Query to find document with our custom ID
    const snapshot = await db.collection('campaignEnquiry')
      .where('enquiryId', '==', enquiryId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }

    // Delete the document using Firestore's ID
    const docId = snapshot.docs[0].id;
    await db.collection('campaignEnquiry').doc(docId).delete();

    return res.status(200).json({ 
      success: true,
      message: 'Enquiry deleted successfully',
      deletedEnquiryId: enquiryId
    });
  } catch (error) {
    console.error('Error deleting enquiry:', error);
    return res.status(500).json({ 
      error: 'Deletion failed',
      details: error.message 
    });
  }
});


router.post('/updateEnquiryLocation/:enquiryId', async (req, res) => {
  try {
    const { enquiryId } = req.params;
    const { latitude, longitude } = req.body;

    if (!latitude || !longitude) {
      return res.status(400).json({ message: 'Latitude and longitude are required' });
    }

    const snapshot = await db.collection('campaignEnquiry')
      .where('enquiryId', '==', enquiryId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ message: 'Enquiry not found' });
    }

    const doc = snapshot.docs[0];

    await doc.ref.update({
      location: new admin.firestore.GeoPoint(parseFloat(latitude), parseFloat(longitude)),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({
      message: 'Location updated successfully',
      enquiryId
    });

  } catch (error) {
    console.error('Error updating location:', error);
    return res.status(500).json({ error: error.message });
  }
});

//--------------------------------------------------------------------------------

// Bulk Scrap Enquiry Endpoints
router.post('/submit-bulk-enquiry', upload.single('scrap'), async (req, res) => {
  try {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    const {
      name,
      company,
      behalfCompany,
      contact,
      origin,
      description,
      quantity,
    } = req.body;

    if (!name || !contact || !origin || !description || !quantity) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['name', 'contact', 'origin', 'description', 'quantity']
      });
    }

    if (!/^\d{10}$/.test(contact)) {
      return res.status(400).json({ error: 'Contact number must be 10 digits' });
    }

    let fileUrl = null;
    let filePath = null; // Store file path for potential deletion later
    if (req.file) {
      try {
        const file = req.file;
        const fileName = `scrap-images/${Date.now()}_${file.originalname}`;
        filePath = fileName;
        const blob = bucket.file(fileName);
        const blobStream = blob.createWriteStream({
          resumable: false,
          metadata: {
            contentType: file.mimetype
          }
        });

        blobStream.end(file.buffer);

        await new Promise((resolve, reject) => {
          blobStream.on('finish', resolve);
          blobStream.on('error', reject);
        });

        await blob.makePublic();
        fileUrl = blob.publicUrl();
      } catch (uploadErr) {
        console.error('File upload error:', uploadErr);
        return res.status(500).json({ error: 'File upload failed' });
      }
    }

    // Generate 8-character alphanumeric ID
    const enquiryId = Math.random().toString(36).substring(2, 10).toUpperCase();

    const data = {
      enquiryId, // Add our custom ID
      type: 'bulk',
      name,
      company: company || null,
      behalfCompany: behalfCompany || null,
      contact,
      origin,
      description,
      quantity,
      imageUrl: fileUrl,
      filePath: filePath, // Store file path for deletion
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await db.collection('bulkEnquiries').add(data);
    
    return res.status(200).json({ 
      success: true,
      message: 'Bulk enquiry submitted successfully',
      enquiryId: enquiryId // Return our custom ID
    });
  } catch (err) {
    console.error('Error submitting bulk enquiry:', err);
    return res.status(500).json({ 
      error: 'Submission failed',
      details: err.message 
    });
  }
});

router.get('/get-bulk-enquiries', async (req, res) => {
  try {
    const { status, sortBy = 'createdAt', sortOrder = 'desc' } = req.query;

    let query = db.collection('bulkEnquiries');

    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      query = query.where('status', '==', status);
    }

    query = query.orderBy(sortBy, sortOrder);

    const snapshot = await query.get();

    if (snapshot.empty) {
      return res.status(200).json({ 
        message: 'No bulk enquiries found',
        enquiries: [] 
      });
    }

    const enquiries = [];
    snapshot.forEach(doc => {
      const enquiry = doc.data();
      enquiries.push({
        firestoreId: doc.id, // Firestore's auto ID
        ...enquiry,
        createdAt: enquiry.createdAt?.toDate().toISOString(),
        updatedAt: enquiry.updatedAt?.toDate().toISOString()
      });
    });

    return res.status(200).json({ 
      success: true,
      enquiries 
    });
  } catch (err) {
    console.error('Error fetching bulk enquiries:', err);
    return res.status(500).json({ 
      success: false,
      error: 'Failed to fetch enquiries',
      details: err.message 
    });
  }
});

router.post('/update-bulk-enquiry-status', async (req, res) => {
  try {
    const { enquiryId, status } = req.body;

    // Validation
    if (!enquiryId || !status) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['enquiryId', 'status']
      });
    }

    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status',
        validStatuses: ['pending', 'approved', 'rejected']
      });
    }

    // Find document by custom enquiryId
    const snapshot = await db.collection('bulkEnquiries')
      .where('enquiryId', '==', enquiryId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'Bulk enquiry not found' });
    }

    const doc = snapshot.docs[0];
    
    // Update status and timestamp
    await db.collection('bulkEnquiries').doc(doc.id).update({
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    });

    return res.status(200).json({
      success: true,
      message: 'Bulk enquiry status updated successfully',
      enquiryId,
      newStatus: status
    });
  } catch (error) {
    console.error('Error updating bulk enquiry status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update status',
      details: error.message
    });
  }
});

router.post('/delete-bulk-enquiry', async (req, res) => {
  try {
    const { enquiryId } = req.body;

    if (!enquiryId) {
      return res.status(400).json({ error: 'Enquiry ID is required' });
    }

    // Find document by custom enquiryId
    const snapshot = await db.collection('bulkEnquiries')
      .where('enquiryId', '==', enquiryId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    // Delete associated file if exists
    if (data.filePath) {
      try {
        await bucket.file(data.filePath).delete();
      } catch (fileErr) {
        console.error('Error deleting file:', fileErr);
      }
    }

    await db.collection('bulkEnquiries').doc(doc.id).delete();

    return res.status(200).json({ 
      success: true,
      message: 'Bulk enquiry deleted successfully',
      deletedEnquiryId: enquiryId
    });
  } catch (error) {
    console.error('Error deleting bulk enquiry:', error);
    return res.status(500).json({ 
      error: 'Deletion failed',
      details: error.message 
    });
  }
});

//--------------------------------------------------------------------------------------------
// Scrap Buyer Enquiry Endpoints
router.post('/submit-buyer-enquiry', upload.single('file'), async (req, res) => {
  try {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    const {
      name,
      company,
      behalfCompany,
      contact,
      designation,
      scrapType,
      description
    } = req.body;

    if (!name || !contact || !scrapType) {
      return res.status(400).json({ 
        error: 'Missing required fields',
        required: ['name', 'contact', 'scrapType']
      });
    }

    if (!/^\d{10}$/.test(contact)) {
      return res.status(400).json({ error: 'Contact number must be 10 digits' });
    }

    let fileUrl = null;
    let filePath = null; // Store file path for potential deletion
    if (req.file) {
      try {
        const file = req.file;
        const fileName = `buyer-docs/${Date.now()}_${file.originalname}`;
        filePath = fileName;
        const fileUpload = bucket.file(fileName);
        const blobStream = fileUpload.createWriteStream({
          metadata: {
            contentType: file.mimetype
          },
          resumable: false
        });

        blobStream.on('error', (err) => {
          throw new Error('File upload failed');
        });

        blobStream.on('finish', async () => {
          await fileUpload.makePublic();
        });

        blobStream.end(file.buffer);

        await new Promise((resolve, reject) => {
          blobStream.on('finish', resolve);
          blobStream.on('error', reject);
        });

        fileUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      } catch (uploadErr) {
        console.error('File upload error:', uploadErr);
        return res.status(500).json({ error: 'File upload failed' });
      }
    }

    // Generate 8-character alphanumeric ID
    const enquiryId = Math.random().toString(36).substring(2, 10).toUpperCase();

    const data = {
      enquiryId, // Our custom ID
      type: 'buyer',
      name,
      company: company || null,
      behalfCompany: behalfCompany || null,
      contact,
      designation: designation || null,
      scrapType,
      description: description || null,
      fileUrl,
      filePath, // Store file path for deletion
      status: 'pending',
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const docRef = await db.collection('buyerEnquiry').add(data);
    
    return res.status(200).json({ 
      success: true,
      message: 'Buyer enquiry submitted successfully',
      enquiryId: enquiryId, // Return our custom ID
      fileUrl: fileUrl || null
    });
  } catch (err) {
    console.error('Error submitting buyer enquiry:', err);
    return res.status(500).json({ 
      error: 'Submission failed',
      details: err.message 
    });
  }
});

router.get('/get-buyer-enquiries', async (req, res) => {
  try {
    const { 
      status, 
      scrapType,
      sortBy = 'createdAt', 
      sortOrder = 'desc',
      limit = 20,
      page = 1
    } = req.query;

    let query = db.collection('buyerEnquiry');

    if (status && ['pending', 'approved', 'rejected'].includes(status)) {
      query = query.where('status', '==', status);
    }

    if (scrapType) {
      query = query.where('scrapType', '==', scrapType);
    }

    query = query.orderBy(sortBy, sortOrder);

    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const offset = (pageNumber - 1) * limitNumber;
    
    const totalSnapshot = await query.count().get();
    const totalCount = totalSnapshot.data().count;
    const totalPages = Math.ceil(totalCount / limitNumber);

    query = query.limit(limitNumber).offset(offset);

    const snapshot = await query.get();

    const enquiries = [];
    snapshot.forEach(doc => {
      const enquiry = doc.data();
      enquiries.push({
        firestoreId: doc.id, // Firestore's auto ID
        ...enquiry,
        createdAt: enquiry.createdAt?.toDate().toISOString(),
        updatedAt: enquiry.updatedAt?.toDate().toISOString()
      });
    });

    return res.status(200).json({
      success: true,
      data: {
        enquiries,
        pagination: {
          totalItems: totalCount,
          totalPages,
          currentPage: pageNumber,
          itemsPerPage: limitNumber
        }
      }
    });
  } catch (err) {
    console.error('Error fetching buyer enquiries:', err);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch enquiries',
      details: err.message
    });
  }
});

router.post('/delete-buyer-enquiry', async (req, res) => {
  try {
    const { enquiryId } = req.body;

    if (!enquiryId) {
      return res.status(400).json({ error: 'Enquiry ID is required' });
    }

    // Find document by custom enquiryId
    const snapshot = await db.collection('buyerEnquiry')
      .where('enquiryId', '==', enquiryId)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }

    const doc = snapshot.docs[0];
    const data = doc.data();

    // Delete associated file if exists
    if (data.filePath) {
      try {
        await bucket.file(data.filePath).delete();
      } catch (fileErr) {
        console.error('Error deleting file:', fileErr);
        // Continue with deletion even if file deletion fails
      }
    }

    // Delete the document using Firestore ID
    await db.collection('buyerEnquiry').doc(doc.id).delete();

    return res.status(200).json({ 
      success: true,
      message: 'Buyer enquiry deleted successfully',
      deletedEnquiryId: enquiryId
    });
  } catch (error) {
    console.error('Error deleting buyer enquiry:', error);
    return res.status(500).json({ 
      error: 'Deletion failed',
      details: error.message 
    });
  }
});

router.post('/update-buyer-enquiry-status', async (req, res) => {
  try {
    const { enquiryId, status, approvedBy } = req.body;

    // Validate required fields
    if (!enquiryId || !status) {
      return res.status(400).json({
        error: 'Missing required fields',
        required: ['enquiryId', 'status']
      });
    }

    // Validate status value
    if (!['pending', 'approved', 'rejected'].includes(status)) {
      return res.status(400).json({ 
        error: 'Invalid status',
        validStatuses: ['pending', 'approved', 'rejected']
      });
    }

    // Additional validation for approval
    if (status === 'approved' && !approvedBy) {
      return res.status(400).json({
        error: 'Missing required field for approval',
        required: ['approvedBy']
      });
    }

    // Find the enquiry document
    const enquiries = await db.collection('buyerEnquiries')
      .where('enquiryId', '==', enquiryId)
      .limit(1)
      .get();

    if (enquiries.empty) {
      return res.status(404).json({ error: 'Enquiry not found' });
    }

    const enquiryDoc = enquiries.docs[0];
    const enquiryData = enquiryDoc.data();

    // Check if enquiry is already processed when trying to change status
    if (enquiryData.status !== 'pending' && status !== enquiryData.status) {
      return res.status(400).json({ 
        error: 'Enquiry already processed',
        currentStatus: enquiryData.status
      });
    }

    // Handle approval - create buyer record
    if (status === 'approved') {
      const buyerData = {
        originalEnquiryId: enquiryId,
        name: enquiryData.name,
        company: enquiryData.company,
        contact: enquiryData.contact,
        designation: enquiryData.designation,
        scrapTypes: Array.isArray(enquiryData.scrapType) ? enquiryData.scrapType : [enquiryData.scrapType],
        documents: enquiryData.fileUrl ? {
          url: enquiryData.fileUrl,
          path: enquiryData.filePath
        } : null,
        status: 'active',
        approvedBy,
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      };

      await db.runTransaction(async (transaction) => {
        transaction.update(enquiryDoc.ref, {
          status: 'approved',
          updatedAt: admin.firestore.FieldValue.serverTimestamp()
        });

      
        // Create buyer record
        transaction.set(db.collection('approvedBuyers').doc(), buyerData);
      
      });

      return res.status(200).json({ 
        success: true,
        message: 'Buyer approved and stored successfully',
        enquiryId,
        newStatus: 'approved',
        buyerCreated: true
      });
    }

    // Handle non-approval status updates (pending, rejected)
    await db.collection('buyerEnquiries').doc(enquiryDoc.id).update({
      status,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      ...(status === 'rejected' && { rejectedAt: admin.firestore.FieldValue.serverTimestamp() })
    });

    return res.status(200).json({
      success: true,
      message: 'Enquiry status updated successfully',
      enquiryId,
      newStatus: status
    });

  } catch (error) {
    console.error('Error updating enquiry status:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update status',
      details: error.message
    });
  }
});

router.post('/add-buyer', upload.single('file'), async (req, res) => {
  try {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, POST');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    const {
      name,
      company,
      contact,
      designation,
      scrapTypes,
      approvedBy,
      description,
      quantity,
      rate
    } = req.body;
  
    // Validate required fields
    if (!name || !contact || !scrapTypes || !approvedBy  || !description || !quantity || !rate) {
      return res.status(400).json({
        success: false,
        error: 'Missing required fields',
        required: ['name', 'contact', 'scrapTypes', 'approvedBy']
      });
    }

    if (!/^\d{10}$/.test(contact)) {
      return res.status(400).json({ 
        success: false,
        error: 'Contact number must be 10 digits' 
      });
    }

    let fileUrl = null;
    let filePath = null;
    if (req.file) {
      try {
        const file = req.file;
        const fileName = `buyer-docs/${Date.now()}_${file.originalname}`;
        filePath = fileName;
        const fileUpload = bucket.file(fileName);
        const blobStream = fileUpload.createWriteStream({
          metadata: {
            contentType: file.mimetype
          },
          resumable: false
        });

        blobStream.on('error', (err) => {
          throw new Error('File upload failed');
        });

        blobStream.on('finish', async () => {
          await fileUpload.makePublic();
        });

        blobStream.end(file.buffer);

        await new Promise((resolve, reject) => {
          blobStream.on('finish', resolve);
          blobStream.on('error', reject);
        });

        fileUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      } catch (uploadErr) {
        console.error('File upload error:', uploadErr);
        return res.status(500).json({ 
          success: false,
          error: 'File upload failed' 
        });
      }
    }


    const normalizedScrapTypes = Array.isArray(scrapTypes) 
      ? scrapTypes 
      : [scrapTypes];

    const buyerData = {
      name,
      company: company || null,
      contact,
      designation: designation || null,
      scrapTypes: normalizedScrapTypes,
      documents: fileUrl ? {
        url: fileUrl,
        path: filePath
      } : null,
      status: 'approved',
      approvedBy,
      description,
      quantity,
      rate,
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    };

    const buyerRef = await db.collection('approvedBuyers').add(buyerData);



    return res.status(200).json({
      success: true,
      message: 'Buyer added successfully',
      buyerId: buyerRef.id,
      fileUrl: fileUrl,
      buyerData: {
        ...buyerData,
        id: buyerRef.id
      }
    });

  } catch (error) {
    console.error('Error adding buyer:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to add buyer',
      details: error.message
    });
  }
});

router.post('/delete-buyer/:buyerId', async (req, res) => {
  try {
    const { buyerId } = req.params;

    if (!buyerId) {
      return res.status(400).json({
        success: false,
        error: 'Missing buyerId parameter'
      });
    }

    const buyerRef = db.collection('approvedBuyers').doc(buyerId);
    const buyerDoc = await buyerRef.get();

    if (!buyerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Buyer not found'
      });
    }

    const buyerData = buyerDoc.data();

    if (buyerData.documents && buyerData.documents.path) {
      try {
        const file = bucket.file(buyerData.documents.path);
        await file.delete();
      } catch (fileErr) {
        console.error('File deletion error:', fileErr);
      }
    }

    await buyerRef.delete();

    return res.status(200).json({
      success: true,
      message: 'Buyer deleted successfully',
      buyerId: buyerId
    });

  } catch (error) {
    console.error('Error deleting buyer:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to delete buyer',
      details: error.message
    });
  }
});

router.put('/update-buyer/:buyerId', upload.single('file'), async (req, res) => {
  try {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET, PUT');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    const { buyerId } = req.params;
    const {
      name,
      company,
      contact,
      designation,
      scrapTypes,
      approvedBy,
      description,
      quantity,
      rate,
      status
    } = req.body;

    if (!buyerId) {
      return res.status(400).json({
        success: false,
        error: 'Missing buyerId parameter'
      });
    }

    const buyerRef = db.collection('approvedBuyers').doc(buyerId);
    const buyerDoc = await buyerRef.get();

    if (!buyerDoc.exists) {
      return res.status(404).json({
        success: false,
        error: 'Buyer not found'
      });
    }

    const existingData = buyerDoc.data();

    let fileUrl = existingData.documents?.url || null;
    let filePath = existingData.documents?.path || null;
    
    if (req.file) {
      try {
        if (filePath) {
          try {
            await bucket.file(filePath).delete();
          } catch (deleteErr) {
            console.error('Old file deletion error:', deleteErr);
          }
        }

        const file = req.file;
        const fileName = `buyer-docs/${Date.now()}_${file.originalname}`;
        filePath = fileName;
        const fileUpload = bucket.file(fileName);
        const blobStream = fileUpload.createWriteStream({
          metadata: {
            contentType: file.mimetype
          },
          resumable: false
        });

        blobStream.on('error', (err) => {
          throw new Error('File upload failed');
        });

        blobStream.on('finish', async () => {
          await fileUpload.makePublic();
        });

        blobStream.end(file.buffer);

        await new Promise((resolve, reject) => {
          blobStream.on('finish', resolve);
          blobStream.on('error', reject);
        });

        fileUrl = `https://storage.googleapis.com/${bucket.name}/${fileName}`;
      } catch (uploadErr) {
        console.error('File upload error:', uploadErr);
        return res.status(500).json({ 
          success: false,
          error: 'File upload failed' 
        });
      }
    }

    const updateData = {
      ...(name && { name }),
      ...(company !== undefined && { company: company || null }),
      ...(contact && { contact }),
      ...(designation !== undefined && { designation: designation || null }),
      ...(scrapTypes && { 
        scrapTypes: Array.isArray(scrapTypes) ? scrapTypes : [scrapTypes] 
      }),
      ...(approvedBy && { approvedBy }),
      ...(description && { description }),
      ...(quantity && { quantity: Number(quantity) }),
      ...(rate && { rate: Number(rate) }),
      ...(status && ['approved', 'pending', 'rejected'].includes(status) && { status }),
      documents: fileUrl ? { url: fileUrl, path: filePath } : null,
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      lastUpdatedBy: approvedBy || existingData.approvedBy
    };

    Object.keys(updateData).forEach(key => updateData[key] === undefined && delete updateData[key]);

    await buyerRef.update(updateData);

    const updatedDoc = await buyerRef.get();
    const updatedData = updatedDoc.data();

    return res.status(200).json({
      success: true,
      message: 'Buyer updated successfully',
      buyerId: buyerId,
      fileUrl: fileUrl,
      buyerData: {
        ...updatedData,
        id: buyerId
      }
    });

  } catch (error) {
    console.error('Error updating buyer:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to update buyer',
      details: error.message
    });
  }
});

router.get('/get-buyers', async (req, res) => {
  try {
    res.set('Access-Control-Allow-Origin', '*');
    res.set('Access-Control-Allow-Methods', 'GET');
    res.set('Access-Control-Allow-Headers', 'Content-Type');

    const { status } = req.query;

    let buyersQuery = db.collection('approvedBuyers');

    // Add status filter if provided
    if (status && ['approved', 'pending', 'rejected'].includes(status)) {
      buyersQuery = buyersQuery.where('status', '==', status);
    }

    // Get all buyers
    const buyersSnapshot = await buyersQuery
      .orderBy('createdAt', 'desc')
      .get();

    const buyers = [];
    buyersSnapshot.forEach(doc => {
      buyers.push({
        id: doc.id,
        ...doc.data(),
        createdAt: doc.data().createdAt?.toDate()?.toISOString(),
        updatedAt: doc.data().updatedAt?.toDate()?.toISOString(),
        approvedAt: doc.data().approvedAt?.toDate()?.toISOString()
      });
    });

    return res.status(200).json({
      success: true,
      data: buyers,
      count: buyers.length
    });

  } catch (error) {
    console.error('Error fetching buyers:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to fetch buyers',
      details: error.message
    });
  }
});

module.exports = router;